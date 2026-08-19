export type TrackingProviderId = 'mock' | 'trucker_tools' | 'macropoint' | 'highway'

/**
 * Mirrors `trackingEventTypeEnum` in `src/db/schema/tracking.ts` exactly —
 * keep the two in sync by hand; this package cannot import the schema (no
 * database access from the integrations layer).
 */
export type TrackingEventType =
  | 'session_started'
  | 'consent_granted'
  | 'consent_revoked'
  | 'location_update'
  | 'geofence_enter'
  | 'geofence_exit'
  | 'arrived_pickup'
  | 'departed_pickup'
  | 'arrived_delivery'
  | 'departed_delivery'
  | 'stopped'
  | 'session_ended'
  | 'error'

export interface TrackingStop {
  stopId: string
  type: 'pickup' | 'delivery'
  lat: number
  lng: number
  /** Index into the route's waypoints this stop corresponds to. */
  waypointIndex: number
}

export interface StartSessionInput {
  loadId: string
  driverPhone: string
  /** Must be true — providers refuse to start a session without recorded consent, same rule as SMS. */
  consentGranted: boolean
  truckUnitNumber?: string
  stops: TrackingStop[]
}

export interface NormalizedTrackingEvent {
  sessionId: string
  provider: TrackingProviderId
  eventType: TrackingEventType
  occurredAt: Date
  lat?: number
  lng?: number
  speedMph?: number
  headingDegrees?: number
  locationLabel?: string
  stopId?: string
  /** The provider's own event id — callers use this as the ingestion idempotency key. */
  rawProviderReference: string
  rawPayload?: Record<string, unknown>
}

export type SessionHealthStatus = 'unknown' | 'healthy' | 'stale' | 'lost' | 'ended'

export interface SessionHealth {
  sessionId: string
  status: SessionHealthStatus
  lastEventAt: Date | null
  routeProgressPercent: number | null
  remainingMiles: number | null
  etaAt: Date | null
}
