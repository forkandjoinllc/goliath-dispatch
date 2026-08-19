/**
 * TollGuru is NOT implemented in this release. Live toll estimation requires
 * a paid TollGuru account and a per-route pricing decision that product has
 * deliberately deferred. This class exists so:
 *   1. `RouteResult.tollCents` has a clear, typed way to be populated later,
 *   2. wiring a real adapter is a one-line change in `./index.ts` once
 *      credentials exist, and
 *   3. any call site that reaches for tolls today fails loudly with
 *      `integration_unavailable` instead of silently returning zero.
 *
 * Do not "helpfully" estimate tolls here (e.g. a flat per-mile heuristic) —
 * that would misrepresent a settlement number as if a real quote had made it.
 */
import { notConfiguredError } from '../_shared/errors'
import type { TollProvider } from './provider'
import type { RouteRequest } from './types'

const PROVIDER_NAME = 'geo.tollguru'

export class TollGuruAdapter implements TollProvider {
  readonly name = PROVIDER_NAME

  async estimateTollCents(_request: RouteRequest): Promise<number> {
    throw notConfiguredError(PROVIDER_NAME, 'integrations.tollguru.notConfigured')
  }
}
