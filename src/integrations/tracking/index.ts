import type { TrackingProvider } from './provider'
import type { TrackingProviderId } from './types'
import { MockTrackingAdapter } from './mock-adapter'
import { TruckerToolsTrackingAdapter } from './trucker-tools-adapter'
import { MacroPointTrackingAdapter } from './macropoint-adapter'
import { HighwayTrackingAdapter } from './highway-adapter'

const instances: Partial<Record<TrackingProviderId, TrackingProvider>> = {}

/**
 * Resolves a tracking provider by id — tenants pick a provider per carrier
 * connection (`integration_connections.category = 'tracking'`), so this
 * takes an explicit id rather than reading one global env driver, unlike
 * the other families. Falls back to `mock` for any id without a live
 * adapter constructed successfully (e.g. `trucker_tools`/`macropoint`/
 * `highway` are settings-screen-only this release — see each adapter's
 * header comment).
 */
export function getTrackingProvider(providerId: TrackingProviderId = 'mock'): TrackingProvider {
  const cached = instances[providerId]
  if (cached) return cached

  let instance: TrackingProvider
  switch (providerId) {
    case 'trucker_tools':
      instance = new TruckerToolsTrackingAdapter()
      break
    case 'macropoint':
      instance = new MacroPointTrackingAdapter()
      break
    case 'highway':
      instance = new HighwayTrackingAdapter()
      break
    default:
      instance = new MockTrackingAdapter()
  }
  instances[providerId] = instance
  return instance
}

/** Test-only: clears every memoized provider instance. */
export function resetTrackingProviderCache(): void {
  for (const key of Object.keys(instances) as TrackingProviderId[]) {
    delete instances[key]
  }
}

export type { TrackingProvider, StartedSession } from './provider'
export type {
  TrackingProviderId,
  TrackingEventType,
  TrackingStop,
  StartSessionInput,
  NormalizedTrackingEvent,
  SessionHealth,
  SessionHealthStatus,
} from './types'
export { MockTrackingAdapter, resetMockTrackingSessions } from './mock-adapter'
export type { MockStartSessionOptions } from './mock-adapter'
