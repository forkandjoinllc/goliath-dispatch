import type { PlaceSuggestion, ResolvedAddress, RouteRequest, RouteResult } from './types'

export interface GeoProvider {
  readonly name: string
  /** `sessionToken` groups a user's keystrokes into one billable Places session; pass the same value across a typeahead interaction. */
  autocomplete(query: string, sessionToken: string): Promise<PlaceSuggestion[]>
  resolvePlace(placeId: string): Promise<ResolvedAddress>
  geocode(freeText: string): Promise<ResolvedAddress>
  timezoneAt(lat: number, lng: number, at: Date): Promise<string>
  route(request: RouteRequest): Promise<RouteResult>
}

/**
 * Toll estimation is a separate, smaller interface — see `tollguru-adapter.ts`
 * for why it is unimplemented in this release.
 */
export interface TollProvider {
  readonly name: string
  estimateTollCents(request: RouteRequest): Promise<number>
}
