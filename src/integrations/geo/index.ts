import { serverEnv } from '@/lib/env'
import type { GeoProvider, TollProvider } from './provider'
import { MockGeoAdapter } from './mock-adapter'
import { GoogleGeoAdapter } from './google-adapter'
import { TollGuruAdapter } from './tollguru-adapter'

let cachedGeo: GeoProvider | null = null
let cachedToll: TollProvider | null = null

/** Resolves the configured geo provider (Places/Geocoding/Routes). `GoogleGeoAdapter` is only constructed when `GEO_DRIVER=google`. */
export function getGeoProvider(): GeoProvider {
  if (cachedGeo) return cachedGeo
  const driver = serverEnv().GEO_DRIVER
  cachedGeo = driver === 'google' ? new GoogleGeoAdapter() : new MockGeoAdapter()
  return cachedGeo
}

/** Toll estimation is deliberately unimplemented for this release — see `./tollguru-adapter.ts`. */
export function getTollProvider(): TollProvider {
  if (cachedToll) return cachedToll
  cachedToll = new TollGuruAdapter()
  return cachedToll
}

/** Test-only: clears memoized providers so a test can flip driver env vars. */
export function resetGeoProviderCache(): void {
  cachedGeo = null
  cachedToll = null
}

export type { GeoProvider, TollProvider } from './provider'
export type {
  PlaceSuggestion,
  ResolvedAddress,
  RouteRequest,
  RouteResult,
  RouteLeg,
  RouteWaypoint,
  RouteVehicleProfile,
} from './types'
export { statesBetween, STATE_ADJACENCY } from './states'
export type { StateCode } from './states'
export { MOCK_CITIES, mockCityWaypoint } from './mock-adapter'
