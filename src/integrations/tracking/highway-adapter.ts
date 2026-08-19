/**
 * Highway carrier tracking — INTEGRATION SETTINGS SCREEN + INTERFACE ONLY
 * for this release. Every method throws `integration_unavailable`. See
 * `trucker-tools-adapter.ts` for why this family ships as settings +
 * interface rather than a live driver this cycle.
 *
 *  - Auth: a per-tenant API key sent as `X-Api-Key`, issued from Highway's
 *    dashboard (Highway is also this app's carrier-identity-verification
 *    vendor in some deployments, but that is a separate product surface
 *    from load tracking and out of scope here).
 *  - Session start: `POST /v1/tracking/sessions` with the load reference and
 *    carrier identifier; Highway matches against carriers already connected
 *    through its own network, which is why a session can fail to start for
 *    a carrier that hasn't onboarded with Highway independently of this app.
 *  - Events: webhook only, signed with HMAC-SHA256 over the raw body using a
 *    per-tenant secret, sent in a `Highway-Signature` header formatted like
 *    Stripe's (`t=<timestamp>,v1=<hex>`).
 */
import { notConfiguredError } from '../_shared/errors'
import type { TrackingProvider, StartedSession } from './provider'
import type { NormalizedTrackingEvent, SessionHealth, StartSessionInput } from './types'

const PROVIDER_NAME = 'tracking.highway'

export class HighwayTrackingAdapter implements TrackingProvider {
  readonly id = 'highway' as const
  readonly name = PROVIDER_NAME

  async startSession(_input: StartSessionInput): Promise<StartedSession> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.highway.notConfigured')
  }

  async endSession(_sessionId: string): Promise<void> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.highway.notConfigured')
  }

  async getSession(_sessionId: string): Promise<SessionHealth> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.highway.notConfigured')
  }

  async pollEvents(_sessionId: string, _since: Date | null): Promise<NormalizedTrackingEvent[]> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.highway.notConfigured')
  }

  async parseWebhook(_payload: unknown, _signature: string | null): Promise<NormalizedTrackingEvent[]> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.highway.notConfigured')
  }
}
