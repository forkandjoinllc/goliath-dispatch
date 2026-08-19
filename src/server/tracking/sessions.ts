import 'server-only'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  consentRecords,
  drivers,
  loadStops,
  loads,
  trackingSessions,
  type LoadStop,
  type Route,
  type RouteState,
  type TrackingSession,
} from '@/db/schema'
import { AppError, notFound, validationFailed } from '@/lib/errors'
import { serverEnv } from '@/lib/env'
import {
  getTrackingProvider,
  MockTrackingAdapter,
  type NormalizedTrackingEvent,
  type StartedSession,
  type TrackingProviderId,
  type TrackingStop,
} from '@/integrations/tracking'
import type { RouteResult, StateCode } from '@/integrations/geo'
import { currentOrCalculateRoute } from '@/server/routes/service'

/**
 * Tracking sessions: consent, lifecycle, health.
 *
 * `startTrackingSession` refuses outright without a recorded, un-revoked
 * `consentRecords` row of type `tracking_location` for the driver's own user
 * account — there is no override path, matching the same hard rule as SMS
 * consent in the tracking provider interface itself
 * (`StartSessionInput.consentGranted` is `true` only because we already
 * checked; the providers re-check too).
 */

/* ── Consent ─────────────────────────────────────────────────────────────── */

const TRACKING_CONSENT_POLICY_VERSION = '1.0'

export async function hasActiveTrackingConsent(db: TenantDb, userId: string): Promise<boolean> {
  return db.exists(
    consentRecords,
    and(
      eq(consentRecords.userId, userId),
      eq(consentRecords.consentType, 'tracking_location'),
      eq(consentRecords.granted, true),
      isNull(consentRecords.revokedAt),
    )!,
  )
}

/** `tracking:consent` is scope `own` — a driver may only ever grant/revoke their own. */
export async function grantTrackingConsent(
  db: TenantDb,
  actor: { userId: string },
  request: { ipAddress: string | null; userAgent: string | null } = { ipAddress: null, userAgent: null },
): Promise<void> {
  await db.insert(consentRecords, {
    userId: actor.userId,
    consentType: 'tracking_location',
    policyVersion: TRACKING_CONSENT_POLICY_VERSION,
    granted: true,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
  })
}

export async function revokeTrackingConsent(db: TenantDb, actor: { userId: string }): Promise<void> {
  await db.updateWhere(
    consentRecords,
    and(
      eq(consentRecords.userId, actor.userId),
      eq(consentRecords.consentType, 'tracking_location'),
      isNull(consentRecords.revokedAt),
    )!,
    { revokedAt: new Date() },
  )

  // Revoking consent ends every tracking session currently open for this
  // driver — location ingestion must stop the instant consent is withdrawn,
  // not merely be blocked for the *next* session.
  const driverRows = await db.findMany(drivers, { where: eq(drivers.userId, actor.userId) })
  for (const driver of driverRows) {
    const openSessions = await db.findMany(trackingSessions, {
      where: and(eq(trackingSessions.driverId, driver.id), isNull(trackingSessions.endedAt))!,
    })
    for (const session of openSessions) {
      await endTrackingSession(db, session.id).catch(() => undefined)
    }
  }
}

/* ── Health ──────────────────────────────────────────────────────────────── */

export type SessionHealthStatus = 'unknown' | 'healthy' | 'stale' | 'lost' | 'ended'

/** Minutes without an event before a session reads as `stale`, then `lost`. */
export const SESSION_STALE_AFTER_MINUTES = 45
export const SESSION_LOST_AFTER_MINUTES = 180

export function computeSessionHealth(
  session: Pick<TrackingSession, 'endedAt' | 'lastEventAt'>,
  now: Date = new Date(),
): SessionHealthStatus {
  if (session.endedAt) return 'ended'
  if (!session.lastEventAt) return 'unknown'
  const minutesSinceEvent = (now.getTime() - session.lastEventAt.getTime()) / 60_000
  if (minutesSinceEvent > SESSION_LOST_AFTER_MINUTES) return 'lost'
  if (minutesSinceEvent > SESSION_STALE_AFTER_MINUTES) return 'stale'
  return 'healthy'
}

/** Recomputes and persists one session's health from the wall clock — used by the fleet view and a sweep job. */
export async function refreshSessionHealth(db: TenantDb, sessionId: string): Promise<TrackingSession> {
  const session = await db.requireById(trackingSessions, sessionId, 'trackingSession')
  const status = computeSessionHealth(session)
  if (status === session.healthStatus) return session
  const updated = await db.update(trackingSessions, sessionId, { healthStatus: status })
  return updated ?? session
}

/* ── Lifecycle ───────────────────────────────────────────────────────────── */

export interface StartTrackingSessionInput {
  loadId: string
  providerId?: TrackingProviderId
  driverId: string
  truckId?: string | null
}

function toMockRouteResult(route: Route, states: RouteState[]): RouteResult {
  const legs = route.legs
  return {
    totalMiles: route.totalMiles ?? 0,
    durationMinutes: route.estimatedDurationMinutes ?? 0,
    polyline: route.polyline ?? '',
    legs: legs.map((leg, index) => ({
      fromIndex: index,
      toIndex: index + 1,
      miles: leg.miles,
      durationMinutes: leg.durationMinutes,
    })),
    states: states.map((s) => s.stateCode) as StateCode[],
  }
}

function toTrackingStops(stops: LoadStop[]): TrackingStop[] {
  return stops.map((stop, index) => {
    if (stop.latitude == null || stop.longitude == null) {
      throw validationFailed('tracking.errors.routeStopMissingCoordinates', { stopId: stop.id, city: stop.city ?? '' })
    }
    return {
      stopId: stop.id,
      type: stop.stopType,
      lat: Number(stop.latitude),
      lng: Number(stop.longitude),
      waypointIndex: index,
    }
  })
}

export async function startTrackingSession(
  db: TenantDb,
  input: StartTrackingSessionInput,
): Promise<TrackingSession> {
  const driver = await db.requireById(drivers, input.driverId, 'driver')
  await db.requireById(loads, input.loadId, 'load')

  if (!driver.userId || !(await hasActiveTrackingConsent(db, driver.userId))) {
    throw new AppError('forbidden', 'errors.trackingConsentMissing')
  }

  const providerId = input.providerId ?? serverEnv().TRACKING_DEFAULT_PROVIDER

  const stops = await db.findMany(loadStops, {
    where: eq(loadStops.loadId, input.loadId),
    orderBy: asc(loadStops.sequence),
  })
  if (stops.length < 2) throw validationFailed('tracking.errors.needsTwoStops')
  const trackingStops = toTrackingStops(stops)

  const provider = getTrackingProvider(providerId)
  const sessionInput = {
    loadId: input.loadId,
    driverPhone: driver.phone ?? '',
    consentGranted: true,
    stops: trackingStops,
  }

  let started: StartedSession
  if (providerId === 'mock') {
    const route = await currentOrCalculateRoute(db, input.loadId)
    if (!route) throw validationFailed('tracking.errors.routeRequired')
    // The mock adapter needs the route it should simulate along; the shared
    // `TrackingProvider` interface has no such parameter because only the
    // mock is fully implemented this release (see each adapter's header
    // comment) — every other provider ignores a second argument it never
    // declares.
    started = await (provider as MockTrackingAdapter).startSession(sessionInput, {
      route: toMockRouteResult(route.route, route.states),
    })
  } else {
    started = await provider.startSession(sessionInput)
  }

  return db.insert(trackingSessions, {
    loadId: input.loadId,
    driverId: input.driverId,
    truckId: input.truckId ?? null,
    provider: providerId,
    // The provider's own handle for every subsequent call
    // (`getSession`/`pollEvents`/`endSession`/`advance`) — for the mock this
    // is `StartedSession.sessionId`, not the cosmetic `.providerSessionId`.
    providerSessionId: started.sessionId,
    consentGrantedAt: new Date(),
    consentUserId: driver.userId,
    startedAt: started.startedAt,
    healthStatus: 'healthy',
  })
}

export async function endTrackingSession(db: TenantDb, sessionId: string): Promise<TrackingSession> {
  const session = await db.requireById(trackingSessions, sessionId, 'trackingSession')

  if (!session.endedAt && session.providerSessionId) {
    const provider = getTrackingProvider(session.provider as TrackingProviderId)
    await provider.endSession(session.providerSessionId).catch(() => undefined)
  }

  const updated = await db.update(trackingSessions, sessionId, { endedAt: new Date(), healthStatus: 'ended' })
  if (!updated) throw notFound('errors.notFound', { entity: 'trackingSession' })
  return updated
}

/** The load's most recent tracking session (by `startedAt`), or null if none has ever started. */
export async function getSessionForLoad(db: TenantDb, loadId: string): Promise<TrackingSession | null> {
  const rows = await db.findMany(trackingSessions, { where: eq(trackingSessions.loadId, loadId) })
  if (rows.length === 0) return null
  return rows.slice().sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))[0] ?? null
}

export async function listActiveSessions(db: TenantDb): Promise<TrackingSession[]> {
  return db.findMany(trackingSessions, { where: isNull(trackingSessions.endedAt) })
}

/**
 * Test/demo-only: advances the mock provider's simulated clock and returns
 * whatever events newly became visible. Exists so the whole tracking flow —
 * session start through delivery — is demonstrable without a real GPS feed.
 * See `app/tracking/[loadId]`'s "simulate movement" control, gated on
 * `TRACKING_DEFAULT_PROVIDER === 'mock'`.
 *
 * Trusts `advance()`'s own return value directly: the adapter now tracks
 * whether a session has ever been advanced and includes every event at
 * `t=0` (session start, consent, an immediate arrival) on the first call —
 * see `MockTrackingAdapter.advance()`'s own comment — so there is no longer
 * a need to work around it by polling since `session.lastEventAt` instead.
 */
export async function advanceMockSession(
  db: TenantDb,
  sessionId: string,
  minutes: number,
): Promise<NormalizedTrackingEvent[]> {
  const session = await db.requireById(trackingSessions, sessionId, 'trackingSession')
  if (session.provider !== 'mock' || !session.providerSessionId) {
    throw validationFailed('tracking.errors.simulationNotAvailable')
  }
  const provider = getTrackingProvider('mock') as MockTrackingAdapter
  return provider.advance(session.providerSessionId, minutes)
}
