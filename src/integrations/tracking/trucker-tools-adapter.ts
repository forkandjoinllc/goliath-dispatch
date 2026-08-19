/**
 * Trucker Tools carrier tracking — INTEGRATION SETTINGS SCREEN + INTERFACE
 * ONLY for this release. Every method throws `integration_unavailable`.
 *
 * This is not a stub left by accident: wiring a real driver-tracking
 * integration involves a carrier-facing onboarding flow inside Trucker
 * Tools' own portal (drivers install their app and link a load number) that
 * has no equivalent for the other providers in this file, and product has
 * deferred building that flow. The shape below is what a real adapter would
 * implement, documented so building it later is additive, not exploratory:
 *
 *  - Auth: a per-tenant API key issued by Trucker Tools, sent as
 *    `Authorization: Bearer <key>` on every REST call.
 *  - Session start: `POST /v3/loads` with load + stop details; response
 *    carries Trucker Tools' own load/tracking id.
 *  - Events: delivered by webhook (`POST` to a tenant-specific URL Trucker
 *    Tools is configured with) — NOT polled. The webhook body is signed with
 *    an HMAC-SHA256 over the raw body using a per-tenant shared secret, sent
 *    in an `X-TT-Signature` header.
 */
import { notConfiguredError } from '../_shared/errors'
import type { TrackingProvider, StartedSession } from './provider'
import type { NormalizedTrackingEvent, SessionHealth, StartSessionInput } from './types'

const PROVIDER_NAME = 'tracking.trucker_tools'

export class TruckerToolsTrackingAdapter implements TrackingProvider {
  readonly id = 'trucker_tools' as const
  readonly name = PROVIDER_NAME

  async startSession(_input: StartSessionInput): Promise<StartedSession> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.truckerTools.notConfigured')
  }

  async endSession(_sessionId: string): Promise<void> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.truckerTools.notConfigured')
  }

  async getSession(_sessionId: string): Promise<SessionHealth> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.truckerTools.notConfigured')
  }

  async pollEvents(_sessionId: string, _since: Date | null): Promise<NormalizedTrackingEvent[]> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.truckerTools.notConfigured')
  }

  async parseWebhook(_payload: unknown, _signature: string | null): Promise<NormalizedTrackingEvent[]> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.truckerTools.notConfigured')
  }
}
