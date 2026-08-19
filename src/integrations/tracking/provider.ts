import type { NormalizedTrackingEvent, SessionHealth, StartSessionInput, TrackingProviderId } from './types'

export interface StartedSession {
  sessionId: string
  providerSessionId: string
  startedAt: Date
}

export interface TrackingProvider {
  readonly id: TrackingProviderId
  readonly name: string
  startSession(input: StartSessionInput): Promise<StartedSession>
  endSession(sessionId: string): Promise<void>
  getSession(sessionId: string): Promise<SessionHealth>
  /** Events strictly after `since` (exclusive), ordered by `occurredAt` ascending. */
  pollEvents(sessionId: string, since: Date | null): Promise<NormalizedTrackingEvent[]>
  /** Verifies and normalizes an inbound webhook payload from this provider. */
  parseWebhook(payload: unknown, signature: string | null): Promise<NormalizedTrackingEvent[]>
}
