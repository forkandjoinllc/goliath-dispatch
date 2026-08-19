import { AppError } from '@/lib/errors'
import { newId } from '@/lib/crypto'
import type { RouteResult, RouteWaypoint } from '../geo/types'
import type { TrackingProvider, StartedSession } from './provider'
import type {
  NormalizedTrackingEvent,
  SessionHealth,
  SessionHealthStatus,
  StartSessionInput,
  TrackingStop,
} from './types'

const PROVIDER_NAME = 'tracking.mock'
const PROVIDER_ID = 'mock' as const

/** Minutes a truck "sits" at a stop before the next location_update resumes. */
const DWELL_MINUTES = 30
/** Cadence of location_update events while moving between two waypoints. */
const LOCATION_UPDATE_CADENCE_MINUTES = 15

export interface MockStartSessionOptions {
  /**
   * The route to simulate along — normally `getGeoProvider().route(...)`
   * computed from the same coordinates as `input.stops`. Every waypoint the
   * route was computed from MUST have a corresponding entry in
   * `input.stops` (ordered by `waypointIndex`) — the simulator drives
   * between consecutive stops using `route.legs`, it has no other source of
   * coordinates.
   */
  route: RouteResult
  startedAt?: Date
}

interface TimelineEntry {
  index: number
  atMinutes: number
  eventType: NormalizedTrackingEvent['eventType']
  lat?: number
  lng?: number
  speedMph?: number
  headingDegrees?: number
  locationLabel?: string
  stopId?: string
}

interface MockSessionState {
  sessionId: string
  providerSessionId: string
  loadId: string
  startedAt: Date
  totalMinutes: number
  totalMiles: number
  timeline: TimelineEntry[]
  /** Advanced by `advance()`; events with `atMinutes <= currentMinutes` are visible. */
  currentMinutes: number
  ended: boolean
  /** False until the first `advance()` call — see that method for why this matters. */
  hasAdvanced: boolean
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function lerp(a: RouteWaypoint, b: RouteWaypoint, t: number): { lat: number; lng: number } {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
}

/** Initial compass bearing from a to b, in degrees [0, 360). */
function bearingDegrees(a: RouteWaypoint, b: RouteWaypoint): number {
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.round((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

function buildTimeline(stops: TrackingStop[], route: RouteResult): { timeline: TimelineEntry[]; totalMinutes: number } {
  const orderedStops = [...stops].sort((a, b) => a.waypointIndex - b.waypointIndex)
  const waypointCount = orderedStops.length
  if (waypointCount < 2) {
    throw new AppError('validation_failed', 'integrations.tracking.mock.needsTwoStops')
  }
  if (route.legs.length !== waypointCount - 1) {
    throw new AppError('validation_failed', 'integrations.tracking.mock.routeStopMismatch', {
      params: { legs: route.legs.length, stops: waypointCount },
    })
  }

  const timeline: TimelineEntry[] = [
    { index: 0, atMinutes: 0, eventType: 'session_started' },
    { index: 0, atMinutes: 0, eventType: 'consent_granted' },
  ]

  let elapsed = 0
  for (let i = 0; i < waypointCount; i += 1) {
    const stop = orderedStops[i]
    const arrivalType = stop.type === 'pickup' ? 'arrived_pickup' : 'arrived_delivery'
    const departureType = stop.type === 'pickup' ? 'departed_pickup' : 'departed_delivery'

    timeline.push({ index: 0, atMinutes: elapsed, eventType: arrivalType, lat: stop.lat, lng: stop.lng, stopId: stop.stopId })

    const isFinalStop = i === waypointCount - 1
    if (!isFinalStop) {
      elapsed += DWELL_MINUTES
      timeline.push({
        index: 0,
        atMinutes: elapsed,
        eventType: departureType,
        lat: stop.lat,
        lng: stop.lng,
        stopId: stop.stopId,
      })

      const leg = route.legs[i]
      const from: RouteWaypoint = { lat: stop.lat, lng: stop.lng }
      const to = orderedStops[i + 1]
      const heading = bearingDegrees(from, { lat: to.lat, lng: to.lng })
      const avgMph = leg.durationMinutes > 0 ? Math.round((leg.miles / leg.durationMinutes) * 60) : 0

      for (let t = LOCATION_UPDATE_CADENCE_MINUTES; t < leg.durationMinutes; t += LOCATION_UPDATE_CADENCE_MINUTES) {
        const fraction = t / leg.durationMinutes
        const position = lerp(from, { lat: to.lat, lng: to.lng }, fraction)
        timeline.push({
          index: 0,
          atMinutes: elapsed + t,
          eventType: 'location_update',
          lat: position.lat,
          lng: position.lng,
          speedMph: avgMph,
          headingDegrees: heading,
        })
      }

      elapsed += leg.durationMinutes
    } else {
      // Final stop: a short dwell, then the session ends where it is.
      elapsed += DWELL_MINUTES
      timeline.push({
        index: 0,
        atMinutes: elapsed,
        eventType: departureType,
        lat: stop.lat,
        lng: stop.lng,
        stopId: stop.stopId,
      })
    }
  }

  timeline.push({ index: 0, atMinutes: elapsed, eventType: 'session_ended' })
  timeline.sort((a, b) => a.atMinutes - b.atMinutes)
  timeline.forEach((entry, index) => {
    entry.index = index
  })
  return { timeline, totalMinutes: elapsed }
}

const sessions = new Map<string, MockSessionState>()

export class MockTrackingAdapter implements TrackingProvider {
  readonly id = PROVIDER_ID
  readonly name = PROVIDER_NAME

  async startSession(input: StartSessionInput, options?: MockStartSessionOptions): Promise<StartedSession> {
    if (!input.consentGranted) {
      throw new AppError('validation_failed', 'integrations.tracking.consentRequired')
    }
    if (!options?.route) {
      throw new AppError('validation_failed', 'integrations.tracking.mock.routeRequired')
    }

    const sessionId = newId()
    const providerSessionId = `mock-session-${sessionId}`
    const startedAt = options.startedAt ?? new Date()
    const { timeline, totalMinutes } = buildTimeline(input.stops, options.route)

    sessions.set(sessionId, {
      sessionId,
      providerSessionId,
      loadId: input.loadId,
      startedAt,
      totalMinutes,
      totalMiles: options.route.totalMiles,
      timeline,
      currentMinutes: 0,
      ended: false,
      hasAdvanced: false,
    })

    return { sessionId, providerSessionId, startedAt }
  }

  async endSession(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    session.ended = true
    session.currentMinutes = session.totalMinutes
  }

  async getSession(sessionId: string): Promise<SessionHealth> {
    const session = this.require(sessionId)
    const visible = this.visibleEvents(session)
    const lastEvent = visible[visible.length - 1] ?? null
    const progress = session.totalMinutes > 0 ? Math.min(100, (session.currentMinutes / session.totalMinutes) * 100) : 100
    const status: SessionHealthStatus = session.ended || session.currentMinutes >= session.totalMinutes ? 'ended' : 'healthy'

    return {
      sessionId,
      status,
      lastEventAt: lastEvent?.occurredAt ?? null,
      routeProgressPercent: Math.round(progress),
      remainingMiles: Math.round(session.totalMiles * (1 - progress / 100)),
      etaAt: new Date(session.startedAt.getTime() + session.totalMinutes * 60_000),
    }
  }

  async pollEvents(sessionId: string, since: Date | null): Promise<NormalizedTrackingEvent[]> {
    const session = this.require(sessionId)
    const visible = this.visibleEvents(session)
    if (!since) return visible
    return visible.filter((event) => event.occurredAt.getTime() > since.getTime())
  }

  async parseWebhook(payload: unknown, _signature: string | null): Promise<NormalizedTrackingEvent[]> {
    // The mock is pull-based (see `pollEvents`/`advance`); this exists only
    // so the interface is fully implemented. Accepts a pre-normalized batch.
    if (payload && typeof payload === 'object' && Array.isArray((payload as { events?: unknown }).events)) {
      return (payload as { events: NormalizedTrackingEvent[] }).events
    }
    return []
  }

  /**
   * Test/seed-only: moves simulated time forward and returns the
   * newly-visible events.
   *
   * The very first call is special: `session_started`/`consent_granted`
   * (and, for a load that starts already at its first stop, an immediate
   * arrival) all sit at `atMinutes === 0`, so a plain `minutesAt > before`
   * filter with `before === 0` would drop every one of them — they satisfy
   * `<= currentMinutes` but never `> 0`. `hasAdvanced` makes that first call
   * inclusive of `atMinutes === 0`; every call after it goes back to the
   * strict `> before` filter, so nothing already returned is ever repeated.
   */
  advance(sessionId: string, minutes: number): NormalizedTrackingEvent[] {
    const session = this.require(sessionId)
    const before = session.currentMinutes
    const isFirstAdvance = !session.hasAdvanced
    session.currentMinutes = Math.min(session.totalMinutes, session.currentMinutes + minutes)
    session.hasAdvanced = true
    if (session.currentMinutes >= session.totalMinutes) session.ended = true
    return this.visibleEvents(session).filter((event) => {
      const minutesAt = (event.occurredAt.getTime() - session.startedAt.getTime()) / 60_000
      if (isFirstAdvance) return minutesAt <= session.currentMinutes
      return minutesAt > before && minutesAt <= session.currentMinutes
    })
  }

  private require(sessionId: string): MockSessionState {
    const session = sessions.get(sessionId)
    if (!session) {
      throw new AppError('not_found', 'integrations.tracking.sessionNotFound', { params: { sessionId } })
    }
    return session
  }

  private visibleEvents(session: MockSessionState): NormalizedTrackingEvent[] {
    return session.timeline
      .filter((entry) => entry.atMinutes <= session.currentMinutes)
      .map((entry) => this.toNormalizedEvent(session, entry))
  }

  private toNormalizedEvent(session: MockSessionState, entry: TimelineEntry): NormalizedTrackingEvent {
    return {
      sessionId: session.sessionId,
      provider: PROVIDER_ID,
      eventType: entry.eventType,
      occurredAt: new Date(session.startedAt.getTime() + entry.atMinutes * 60_000),
      lat: entry.lat,
      lng: entry.lng,
      speedMph: entry.speedMph,
      headingDegrees: entry.headingDegrees,
      locationLabel: entry.locationLabel,
      stopId: entry.stopId,
      // Stable regardless of how much of the timeline is currently visible.
      rawProviderReference: `${session.providerSessionId}-evt-${entry.index}`,
    }
  }
}

/** Test-only: clears every in-memory simulated session. */
export function resetMockTrackingSessions(): void {
  sessions.clear()
}
