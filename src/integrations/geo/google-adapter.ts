/**
 * Live adapter for Google Maps Platform: Places Autocomplete (New), Place
 * Details (New), the classic Geocoding + Time Zone APIs, and Routes API v2.
 * Selected only when `GEO_DRIVER=google`; never constructed otherwise.
 *
 * Uses the SERVER key (`GOOGLE_MAPS_SERVER_API_KEY`) exclusively. The Places
 * (New) and Routes v2 APIs take the key as the `X-Goog-Api-Key` header, so it
 * never touches a URL. The legacy Geocoding/Time Zone APIs only accept a
 * `key` query parameter — for those we redact it from every log line via
 * `fetchJson`'s `redactQueryParams`, matching the FMCSA adapter's approach.
 * The key is never returned to a caller.
 */
import { serverEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import { fetchJson } from '../_shared/http'
import { mapProviderError } from '../_shared/errors'
import { statesBetween, type StateCode } from './states'
import type { GeoProvider } from './provider'
import type { PlaceSuggestion, ResolvedAddress, RouteLeg, RouteRequest, RouteResult } from './types'

const PROVIDER_NAME = 'geo.google'
const PLACES_BASE = 'https://places.googleapis.com/v1'
const GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json'
const TIMEZONE_BASE = 'https://maps.googleapis.com/maps/api/timezone/json'
const ROUTES_BASE = 'https://routes.googleapis.com/directions/v2:computeRoutes'

interface AutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string
      text?: { text?: string }
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } }
    }
  }>
}

interface PlaceDetailsResponse {
  id?: string
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>
}

interface GeocodeResponse {
  status?: string
  results?: Array<{
    formatted_address?: string
    geometry?: { location?: { lat?: number; lng?: number } }
    place_id?: string
    address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>
  }>
}

interface TimezoneResponse {
  status?: string
  timeZoneId?: string
}

interface RoutesResponse {
  routes?: Array<{
    distanceMeters?: number
    duration?: string
    polyline?: { encodedPolyline?: string }
    legs?: Array<{ distanceMeters?: number; duration?: string }>
  }>
}

function metersToMiles(meters: number | undefined): number {
  return Math.round(((meters ?? 0) / 1609.344) * 10) / 10
}

/** Google returns durations like "1234s". */
function durationSecondsToMinutes(duration: string | undefined): number {
  if (!duration) return 0
  const seconds = Number(duration.replace(/s$/, ''))
  return Number.isFinite(seconds) ? Math.round(seconds / 60) : 0
}

function findComponent(
  components: Array<{ long_name?: string; short_name?: string; types?: string[] }> | undefined,
  type: string,
): { long?: string; short?: string } {
  const match = components?.find((c) => c.types?.includes(type))
  return { long: match?.long_name, short: match?.short_name }
}

function findComponentNew(
  components: Array<{ longText?: string; shortText?: string; types?: string[] }> | undefined,
  type: string,
): { long?: string; short?: string } {
  const match = components?.find((c) => c.types?.includes(type))
  return { long: match?.longText, short: match?.shortText }
}

export class GoogleGeoAdapter implements GeoProvider {
  readonly name = PROVIDER_NAME

  private readonly apiKey: string

  constructor() {
    const key = serverEnv().GOOGLE_MAPS_SERVER_API_KEY
    if (!key) {
      throw mapProviderError(
        PROVIDER_NAME,
        new Error('GOOGLE_MAPS_SERVER_API_KEY is not set'),
        'integrations.geo.notConfigured',
      )
    }
    this.apiKey = key
  }

  async autocomplete(query: string, sessionToken: string): Promise<PlaceSuggestion[]> {
    try {
      const response = await fetchJson<AutocompleteResponse>(`${PLACES_BASE}/places:autocomplete`, {
        method: 'POST',
        provider: PROVIDER_NAME,
        headers: { 'X-Goog-Api-Key': this.apiKey },
        body: { input: query, sessionToken },
      })
      return (response.suggestions ?? []).flatMap((s) => {
        const prediction = s.placePrediction
        if (!prediction?.placeId) return []
        return [
          {
            placeId: prediction.placeId,
            description: prediction.text?.text ?? '',
            mainText: prediction.structuredFormat?.mainText?.text,
            secondaryText: prediction.structuredFormat?.secondaryText?.text,
          },
        ]
      })
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.geo.unavailable')
    }
  }

  async resolvePlace(placeId: string): Promise<ResolvedAddress> {
    try {
      const response = await fetchJson<PlaceDetailsResponse>(
        `${PLACES_BASE}/places/${encodeURIComponent(placeId)}`,
        {
          provider: PROVIDER_NAME,
          headers: {
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents',
          },
        },
      )
      const lat = response.location?.latitude ?? 0
      const lng = response.location?.longitude ?? 0
      const address: ResolvedAddress = {
        line1: [
          findComponentNew(response.addressComponents, 'street_number').long,
          findComponentNew(response.addressComponents, 'route').long,
        ]
          .filter(Boolean)
          .join(' ') || undefined,
        city:
          findComponentNew(response.addressComponents, 'locality').long ??
          findComponentNew(response.addressComponents, 'postal_town').long,
        state: findComponentNew(response.addressComponents, 'administrative_area_level_1').short,
        postal: findComponentNew(response.addressComponents, 'postal_code').long,
        country: findComponentNew(response.addressComponents, 'country').short,
        lat,
        lng,
        placeId: response.id ?? placeId,
      }
      address.timezone = await this.timezoneAt(lat, lng, new Date())
      return address
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.geo.unavailable')
    }
  }

  async geocode(freeText: string): Promise<ResolvedAddress> {
    try {
      const url = `${GEOCODE_BASE}?address=${encodeURIComponent(freeText)}&key=${encodeURIComponent(this.apiKey)}`
      const response = await fetchJson<GeocodeResponse>(url, {
        provider: PROVIDER_NAME,
        redactQueryParams: ['key'],
      })
      const result = response.results?.[0]
      if (!result || response.status !== 'OK') {
        throw new Error(`Google geocode returned status ${response.status ?? 'UNKNOWN'} for "${freeText}"`)
      }
      const lat = result.geometry?.location?.lat ?? 0
      const lng = result.geometry?.location?.lng ?? 0
      return {
        line1: [
          findComponent(result.address_components, 'street_number').long,
          findComponent(result.address_components, 'route').long,
        ]
          .filter(Boolean)
          .join(' ') || undefined,
        city:
          findComponent(result.address_components, 'locality').long ??
          findComponent(result.address_components, 'postal_town').long,
        state: findComponent(result.address_components, 'administrative_area_level_1').short,
        postal: findComponent(result.address_components, 'postal_code').long,
        country: findComponent(result.address_components, 'country').short,
        lat,
        lng,
        placeId: result.place_id,
        timezone: await this.timezoneAt(lat, lng, new Date()),
      }
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.geo.unavailable')
    }
  }

  async timezoneAt(lat: number, lng: number, at: Date): Promise<string> {
    try {
      const timestamp = Math.floor(at.getTime() / 1000)
      const url = `${TIMEZONE_BASE}?location=${lat},${lng}&timestamp=${timestamp}&key=${encodeURIComponent(this.apiKey)}`
      const response = await fetchJson<TimezoneResponse>(url, {
        provider: PROVIDER_NAME,
        redactQueryParams: ['key'],
      })
      if (response.status !== 'OK' || !response.timeZoneId) {
        throw new Error(`Google time zone returned status ${response.status ?? 'UNKNOWN'}`)
      }
      return response.timeZoneId
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.geo.unavailable')
    }
  }

  async route(request: RouteRequest): Promise<RouteResult> {
    if (request.waypoints.length < 2) {
      throw mapProviderError(
        PROVIDER_NAME,
        new Error('route() requires at least an origin and a destination'),
        'integrations.geo.invalidRoute',
      )
    }
    try {
      const [origin, destination] = [request.waypoints[0], request.waypoints[request.waypoints.length - 1]]
      const intermediates = request.waypoints.slice(1, -1)
      const response = await fetchJson<RoutesResponse>(ROUTES_BASE, {
        method: 'POST',
        provider: PROVIDER_NAME,
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask':
            'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration',
        },
        body: {
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
          intermediates: intermediates.map((wp) => ({
            location: { latLng: { latitude: wp.lat, longitude: wp.lng } },
          })),
          travelMode: 'DRIVE',
          routeModifiers: {
            vehicleInfo: request.vehicleProfile?.totalWeightPounds
              ? { emissionType: 'GASOLINE' }
              : undefined,
          },
        },
      })
      const route = response.routes?.[0]
      if (!route) {
        throw new Error('Google Routes API returned no route')
      }
      const legs: RouteLeg[] = (route.legs ?? []).map((leg, index) => ({
        fromIndex: index,
        toIndex: index + 1,
        miles: metersToMiles(leg.distanceMeters),
        durationMinutes: durationSecondsToMinutes(leg.duration),
      }))

      const states = await this.approximateStatesTraversed(request.waypoints)

      return {
        totalMiles: metersToMiles(route.distanceMeters),
        durationMinutes: durationSecondsToMinutes(route.duration),
        polyline: route.polyline?.encodedPolyline ?? '',
        legs,
        states,
      }
    } catch (error) {
      logger.warn('google routes call failed', { provider: PROVIDER_NAME })
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.geo.unavailable')
    }
  }

  /**
   * Routes API v2 does not return a per-state breakdown. We reverse-geocode
   * each waypoint to find its state, then fill the gaps between consecutive
   * waypoint states with `statesBetween`'s adjacency walk — the same
   * degraded path documented in `./states.ts`.
   */
  private async approximateStatesTraversed(
    waypoints: RouteRequest['waypoints'],
  ): Promise<StateCode[]> {
    const perWaypointStates: StateCode[] = []
    for (const wp of waypoints) {
      const tz = await this.reverseGeocodeState(wp.lat, wp.lng)
      if (tz) perWaypointStates.push(tz)
    }
    if (perWaypointStates.length < 2) return perWaypointStates

    const states: StateCode[] = [perWaypointStates[0]]
    for (let i = 1; i < perWaypointStates.length; i += 1) {
      const segment = statesBetween(perWaypointStates[i - 1], perWaypointStates[i])
      for (const s of segment.slice(1)) states.push(s)
    }
    return states.filter((s, i) => i === 0 || s !== states[i - 1])
  }

  private async reverseGeocodeState(lat: number, lng: number): Promise<StateCode | undefined> {
    try {
      const url = `${GEOCODE_BASE}?latlng=${lat},${lng}&key=${encodeURIComponent(this.apiKey)}`
      const response = await fetchJson<GeocodeResponse>(url, {
        provider: PROVIDER_NAME,
        redactQueryParams: ['key'],
      })
      const short = findComponent(response.results?.[0]?.address_components, 'administrative_area_level_1')
        .short
      return short as StateCode | undefined
    } catch {
      return undefined
    }
  }
}
