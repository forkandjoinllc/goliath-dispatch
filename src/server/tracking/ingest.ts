import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { loadStops, trackingEvents, trackingSessions, type LoadStop, type TrackingSession } from '@/db/schema'
import { isAppError } from '@/lib/errors'
import { getTrackingProvider, type NormalizedTrackingEvent, type TrackingProviderId } from '@/integrations/tracking'
import { recordStopArrival, recordStopDeparture, transitionStatus } from '@/server/loads/service'
import type { LoadStatus } from '@/server/loads/status-machine'
import { computeSessionHealth } from './sessions'

/**
 * Event ingestion.
 *
 * `ingestEvents` is idempotent on `(provider, rawProviderReference)` — the
 * unique index on `tracking_events` backs this, but duplicates are filtered
 * *before* insert (rather than caught as constraint violations) so a
 * resubmitted batch is silently a no-op, not a partial failure. It updates
 * the session's last-known snapshot, detects stop arrival/departure, and
 * drives the load status machine through
 * `src/server/loads/service.ts::transitionStatus` — never by writing
 * `load_status_history` directly, and never past `delivered` (POD is a
 * document event, not a location one, so `departed_delivery` only records
 * the stop's departure).
 */

export interface IngestEventsResult {
  ingested: number
  duplicates: number
}

const NO_ACTOR = { userId: null }
const NO_REQUEST = { ipAddress: null, userAgent: null }

async function tryTransition(db: TenantDb, loadId: string, to: LoadStatus, event: NormalizedTrackingEvent) {
  try {
    await transitionStatus(db, NO_ACTOR, NO_REQUEST, {
      loadId,
      to,
      source: 'tracking_provider',
      sourceReference: event.rawProviderReference,
    })
  } catch (error) {
    // Not every event maps to a legal transition from the load's current
    // status — duplicates, out-of-order delivery, or a load a dispatcher has
    // already moved further along. Ingestion must stay idempotent and never
    // fail the whole batch over one non-actionable transition.
    if (isAppError(error) && error.code === 'conflict') return
    throw error
  }
}

async function markArrival(
  db: TenantDb,
  stopById: Map<string, LoadStop>,
  stopId: string | undefined,
  at: Date,
): Promise<void> {
  if (!stopId) return
  const stop = stopById.get(stopId)
  if (!stop || stop.actualArrivalAt) return
  const updated = await recordStopArrival(db, { userId: 'tracking_provider' }, { stopId, arrivedAt: at })
  stopById.set(stopId, updated)
}

async function markDeparture(
  db: TenantDb,
  stopById: Map<string, LoadStop>,
  stopId: string | undefined,
  at: Date,
): Promise<void> {
  if (!stopId) return
  const stop = stopById.get(stopId)
  if (!stop || stop.actualDepartureAt) return
  if (!stop.actualArrivalAt) {
    // Out-of-order delivery from the provider — backfill the arrival at the
    // same timestamp rather than dropping the departure on the floor.
    await markArrival(db, stopById, stopId, at)
  }
  const updated = await recordStopDeparture(db, { userId: 'tracking_provider' }, { stopId, departedAt: at })
  stopById.set(stopId, updated)
}

async function applyEventSideEffects(
  db: TenantDb,
  loadId: string,
  stopById: Map<string, LoadStop>,
  event: NormalizedTrackingEvent,
): Promise<void> {
  switch (event.eventType) {
    case 'session_started':
      await tryTransition(db, loadId, 'en_route_to_pickup', event)
      return

    case 'arrived_pickup':
      await markArrival(db, stopById, event.stopId, event.occurredAt)
      await tryTransition(db, loadId, 'at_pickup', event)
      return

    case 'departed_pickup':
      await markDeparture(db, stopById, event.stopId, event.occurredAt)
      await tryTransition(db, loadId, 'in_transit', event)
      return

    case 'arrived_delivery':
      await markArrival(db, stopById, event.stopId, event.occurredAt)
      await tryTransition(db, loadId, 'at_delivery', event)
      return

    case 'departed_delivery':
      // Deliberately no status transition: POD is a document event, not a
      // location one. `delivered` is set by the loads domain, never here.
      await markDeparture(db, stopById, event.stopId, event.occurredAt)
      return

    case 'geofence_enter': {
      const stop = event.stopId ? stopById.get(event.stopId) : undefined
      if (!stop) return
      await markArrival(db, stopById, event.stopId, event.occurredAt)
      await tryTransition(db, loadId, stop.stopType === 'pickup' ? 'at_pickup' : 'at_delivery', event)
      return
    }

    case 'geofence_exit': {
      const stop = event.stopId ? stopById.get(event.stopId) : undefined
      if (!stop) return
      await markDeparture(db, stopById, event.stopId, event.occurredAt)
      if (stop.stopType === 'pickup') await tryTransition(db, loadId, 'in_transit', event)
      return
    }

    case 'location_update':
    case 'stopped':
    case 'consent_granted':
    case 'consent_revoked':
    case 'session_ended':
    case 'error':
    default:
      return
  }
}

/** Best-effort refresh of route progress / remaining miles / ETA from the provider's own computation — never fabricated locally. */
async function refreshProgressFromProvider(
  session: TrackingSession,
): Promise<Pick<TrackingSession, 'routeProgressPercent' | 'remainingMiles' | 'etaAt'> | null> {
  if (!session.providerSessionId) return null
  try {
    const provider = getTrackingProvider(session.provider as TrackingProviderId)
    const health = await provider.getSession(session.providerSessionId)
    return {
      routeProgressPercent: health.routeProgressPercent,
      remainingMiles: health.remainingMiles,
      etaAt: health.etaAt,
    }
  } catch {
    return null
  }
}

export async function ingestEvents(
  db: TenantDb,
  sessionId: string,
  events: NormalizedTrackingEvent[],
): Promise<IngestEventsResult> {
  if (events.length === 0) return { ingested: 0, duplicates: 0 }

  const session = await db.requireById(trackingSessions, sessionId, 'trackingSession')

  const refs = [...new Set(events.map((e) => e.rawProviderReference))]
  const existing = await db.findMany(trackingEvents, {
    where: and(eq(trackingEvents.provider, session.provider), inArray(trackingEvents.rawProviderReference, refs))!,
  })
  const existingRefs = new Set(existing.map((e) => e.rawProviderReference))

  const newEvents = events
    .filter((e) => !existingRefs.has(e.rawProviderReference))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

  if (newEvents.length === 0) {
    return { ingested: 0, duplicates: events.length }
  }

  const stops = await db.findMany(loadStops, {
    where: eq(loadStops.loadId, session.loadId),
    orderBy: asc(loadStops.sequence),
  })
  const stopById = new Map(stops.map((s) => [s.id, s]))

  let lastOccurredAt = session.lastEventAt
  let lastLat: string | null = session.lastLatitude
  let lastLng: string | null = session.lastLongitude
  let lastLabel: string | null = session.lastLocationLabel

  for (const event of newEvents) {
    await db.insert(trackingEvents, {
      sessionId,
      loadId: session.loadId,
      provider: session.provider,
      eventType: event.eventType,
      latitude: event.lat != null ? String(event.lat) : null,
      longitude: event.lng != null ? String(event.lng) : null,
      speedMph: event.speedMph ?? null,
      headingDegrees: event.headingDegrees ?? null,
      locationLabel: event.locationLabel ?? null,
      stopId: event.stopId ?? null,
      rawProviderReference: event.rawProviderReference,
      rawPayload: event.rawPayload ?? null,
      occurredAt: event.occurredAt,
    })

    await applyEventSideEffects(db, session.loadId, stopById, event)

    lastOccurredAt = event.occurredAt
    if (event.lat != null && event.lng != null) {
      lastLat = String(event.lat)
      lastLng = String(event.lng)
      lastLabel = event.locationLabel ?? lastLabel
    }
  }

  const progress = await refreshProgressFromProvider(session)

  await db.update(trackingSessions, sessionId, {
    lastEventAt: lastOccurredAt,
    lastLatitude: lastLat,
    lastLongitude: lastLng,
    lastLocationLabel: lastLabel,
    routeProgressPercent: progress?.routeProgressPercent ?? session.routeProgressPercent,
    remainingMiles: progress?.remainingMiles ?? session.remainingMiles,
    etaAt: progress?.etaAt ?? session.etaAt,
    healthStatus: computeSessionHealth({ endedAt: session.endedAt, lastEventAt: lastOccurredAt }),
  })

  return { ingested: newEvents.length, duplicates: events.length - newEvents.length }
}
