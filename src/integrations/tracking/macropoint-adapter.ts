/**
 * MacroPoint (Descartes) carrier tracking — INTEGRATION SETTINGS SCREEN +
 * INTERFACE ONLY for this release. Every method throws
 * `integration_unavailable`. See `trucker-tools-adapter.ts` for why this
 * family ships as settings + interface rather than a live driver this cycle.
 *
 *  - Auth: OAuth2 client-credentials grant against MacroPoint's identity
 *    endpoint; the resulting bearer token is short-lived and must be
 *    refreshed, not stored long-term.
 *  - Session start: `POST /brokertracking/rest/loads` with carrier MC/DOT,
 *    driver phone, and stop sequence — MacroPoint resolves a
 *    voice/SMS/app opt-in with the driver directly.
 *  - Events: both a polling endpoint (`GET /rest/loads/{id}/tracking`) and a
 *    webhook are available; the webhook path is preferred for latency and
 *    is authenticated with a static shared-secret header rather than a
 *    computed signature.
 */
import { notConfiguredError } from '../_shared/errors'
import type { TrackingProvider, StartedSession } from './provider'
import type { NormalizedTrackingEvent, SessionHealth, StartSessionInput } from './types'

const PROVIDER_NAME = 'tracking.macropoint'

export class MacroPointTrackingAdapter implements TrackingProvider {
  readonly id = 'macropoint' as const
  readonly name = PROVIDER_NAME

  async startSession(_input: StartSessionInput): Promise<StartedSession> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.macropoint.notConfigured')
  }

  async endSession(_sessionId: string): Promise<void> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.macropoint.notConfigured')
  }

  async getSession(_sessionId: string): Promise<SessionHealth> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.macropoint.notConfigured')
  }

  async pollEvents(_sessionId: string, _since: Date | null): Promise<NormalizedTrackingEvent[]> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.macropoint.notConfigured')
  }

  async parseWebhook(_payload: unknown, _signature: string | null): Promise<NormalizedTrackingEvent[]> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tracking.macropoint.notConfigured')
  }
}
