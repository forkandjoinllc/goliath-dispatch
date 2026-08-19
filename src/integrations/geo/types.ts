import type { StateCode } from './states'

export interface PlaceSuggestion {
  placeId: string
  description: string
  mainText?: string
  secondaryText?: string
}

export interface ResolvedAddress {
  line1?: string
  city?: string
  state?: StateCode | string
  postal?: string
  country?: string
  lat: number
  lng: number
  placeId?: string
  timezone?: string
}

/** Heavy-haul flags that change legal routing (bridge law, permit corridors, low clearances, …). */
export interface RouteVehicleProfile {
  overweight?: boolean
  overheight?: boolean
  overwidth?: boolean
  overlength?: boolean
  axleCount?: number
  totalWeightPounds?: number
  heightInches?: number
  widthInches?: number
  lengthInches?: number
}

export interface RouteWaypoint {
  lat: number
  lng: number
  label?: string
}

export interface RouteRequest {
  /** Ordered stops: first is origin, last is destination, interior points are via-stops. */
  waypoints: RouteWaypoint[]
  vehicleProfile?: RouteVehicleProfile
}

export interface RouteLeg {
  fromIndex: number
  toIndex: number
  miles: number
  durationMinutes: number
}

export interface RouteResult {
  totalMiles: number
  durationMinutes: number
  /** Encoded polyline (Google's standard encoding) — decode client-side for a map. */
  polyline: string
  legs: RouteLeg[]
  /** States traversed, in travel order, deduplicated of consecutive repeats. */
  states: StateCode[]
  tollCents?: number
}

export type { StateCode } from './states'
