import type { GeoProvider } from './provider'
import { statesBetween, type StateCode } from './states'
import type { PlaceSuggestion, ResolvedAddress, RouteLeg, RouteRequest, RouteResult, RouteWaypoint } from './types'

const PROVIDER_NAME = 'geo.mock'

interface MockCity {
  id: string
  name: string
  state: StateCode
  lat: number
  lng: number
  timezone: string
}

/**
 * ~40 US cities with real coordinates, spread across enough states that the
 * mock router's `statesBetween` chaining produces plausible multi-state
 * lanes. This is the entire offline dataset backing `GEO_DRIVER=mock` (the
 * default) — good enough that oversize evaluation and the map/tracking UIs
 * work with zero API key.
 */
export const MOCK_CITIES: MockCity[] = [
  { id: 'houston-tx', name: 'Houston', state: 'TX', lat: 29.7604, lng: -95.3698, timezone: 'America/Chicago' },
  { id: 'dallas-tx', name: 'Dallas', state: 'TX', lat: 32.7767, lng: -96.797, timezone: 'America/Chicago' },
  { id: 'san-antonio-tx', name: 'San Antonio', state: 'TX', lat: 29.4241, lng: -98.4936, timezone: 'America/Chicago' },
  { id: 'austin-tx', name: 'Austin', state: 'TX', lat: 30.2672, lng: -97.7431, timezone: 'America/Chicago' },
  { id: 'oklahoma-city-ok', name: 'Oklahoma City', state: 'OK', lat: 35.4676, lng: -97.5164, timezone: 'America/Chicago' },
  { id: 'tulsa-ok', name: 'Tulsa', state: 'OK', lat: 36.154, lng: -95.9928, timezone: 'America/Chicago' },
  { id: 'kansas-city-mo', name: 'Kansas City', state: 'MO', lat: 39.0997, lng: -94.5786, timezone: 'America/Chicago' },
  { id: 'st-louis-mo', name: 'St. Louis', state: 'MO', lat: 38.627, lng: -90.1994, timezone: 'America/Chicago' },
  { id: 'chicago-il', name: 'Chicago', state: 'IL', lat: 41.8781, lng: -87.6298, timezone: 'America/Chicago' },
  { id: 'indianapolis-in', name: 'Indianapolis', state: 'IN', lat: 39.7684, lng: -86.1581, timezone: 'America/New_York' },
  { id: 'columbus-oh', name: 'Columbus', state: 'OH', lat: 39.9612, lng: -82.9988, timezone: 'America/New_York' },
  { id: 'cleveland-oh', name: 'Cleveland', state: 'OH', lat: 41.4993, lng: -81.6944, timezone: 'America/New_York' },
  { id: 'pittsburgh-pa', name: 'Pittsburgh', state: 'PA', lat: 40.4406, lng: -79.9959, timezone: 'America/New_York' },
  { id: 'philadelphia-pa', name: 'Philadelphia', state: 'PA', lat: 39.9526, lng: -75.1652, timezone: 'America/New_York' },
  { id: 'new-york-ny', name: 'New York', state: 'NY', lat: 40.7128, lng: -74.006, timezone: 'America/New_York' },
  { id: 'boston-ma', name: 'Boston', state: 'MA', lat: 42.3601, lng: -71.0589, timezone: 'America/New_York' },
  { id: 'atlanta-ga', name: 'Atlanta', state: 'GA', lat: 33.749, lng: -84.388, timezone: 'America/New_York' },
  { id: 'charlotte-nc', name: 'Charlotte', state: 'NC', lat: 35.2271, lng: -80.8431, timezone: 'America/New_York' },
  { id: 'jacksonville-fl', name: 'Jacksonville', state: 'FL', lat: 30.3322, lng: -81.6557, timezone: 'America/New_York' },
  { id: 'miami-fl', name: 'Miami', state: 'FL', lat: 25.7617, lng: -80.1918, timezone: 'America/New_York' },
  { id: 'tampa-fl', name: 'Tampa', state: 'FL', lat: 27.9506, lng: -82.4572, timezone: 'America/New_York' },
  { id: 'new-orleans-la', name: 'New Orleans', state: 'LA', lat: 29.9511, lng: -90.0715, timezone: 'America/Chicago' },
  { id: 'memphis-tn', name: 'Memphis', state: 'TN', lat: 35.1495, lng: -90.049, timezone: 'America/Chicago' },
  { id: 'nashville-tn', name: 'Nashville', state: 'TN', lat: 36.1627, lng: -86.7816, timezone: 'America/Chicago' },
  { id: 'louisville-ky', name: 'Louisville', state: 'KY', lat: 38.2527, lng: -85.7585, timezone: 'America/New_York' },
  { id: 'denver-co', name: 'Denver', state: 'CO', lat: 39.7392, lng: -104.9903, timezone: 'America/Denver' },
  { id: 'salt-lake-city-ut', name: 'Salt Lake City', state: 'UT', lat: 40.7608, lng: -111.891, timezone: 'America/Denver' },
  { id: 'phoenix-az', name: 'Phoenix', state: 'AZ', lat: 33.4484, lng: -112.074, timezone: 'America/Phoenix' },
  { id: 'las-vegas-nv', name: 'Las Vegas', state: 'NV', lat: 36.1699, lng: -115.1398, timezone: 'America/Los_Angeles' },
  { id: 'los-angeles-ca', name: 'Los Angeles', state: 'CA', lat: 34.0522, lng: -118.2437, timezone: 'America/Los_Angeles' },
  { id: 'san-francisco-ca', name: 'San Francisco', state: 'CA', lat: 37.7749, lng: -122.4194, timezone: 'America/Los_Angeles' },
  { id: 'seattle-wa', name: 'Seattle', state: 'WA', lat: 47.6062, lng: -122.3321, timezone: 'America/Los_Angeles' },
  { id: 'portland-or', name: 'Portland', state: 'OR', lat: 45.5152, lng: -122.6784, timezone: 'America/Los_Angeles' },
  { id: 'omaha-ne', name: 'Omaha', state: 'NE', lat: 41.2565, lng: -95.9345, timezone: 'America/Chicago' },
  { id: 'minneapolis-mn', name: 'Minneapolis', state: 'MN', lat: 44.9778, lng: -93.265, timezone: 'America/Chicago' },
  { id: 'detroit-mi', name: 'Detroit', state: 'MI', lat: 42.3314, lng: -83.0458, timezone: 'America/New_York' },
  { id: 'baltimore-md', name: 'Baltimore', state: 'MD', lat: 39.2904, lng: -76.6122, timezone: 'America/New_York' },
  { id: 'washington-dc', name: 'Washington', state: 'DC', lat: 38.9072, lng: -77.0369, timezone: 'America/New_York' },
  { id: 'richmond-va', name: 'Richmond', state: 'VA', lat: 37.5407, lng: -77.436, timezone: 'America/New_York' },
  { id: 'albuquerque-nm', name: 'Albuquerque', state: 'NM', lat: 35.0844, lng: -106.6504, timezone: 'America/Denver' },
]

const CITY_BY_ID = new Map(MOCK_CITIES.map((c) => [c.id, c]))

function placeIdOf(city: MockCity): string {
  return `mock:${city.id}`
}

function cityFromPlaceId(placeId: string): MockCity | undefined {
  const id = placeId.startsWith('mock:') ? placeId.slice('mock:'.length) : placeId
  return CITY_BY_ID.get(id)
}

function deterministicHash(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function findNearestCity(lat: number, lng: number): MockCity {
  let best = MOCK_CITIES[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const city of MOCK_CITIES) {
    const d = (city.lat - lat) ** 2 + (city.lng - lng) ** 2
    if (d < bestDistance) {
      bestDistance = d
      best = city
    }
  }
  return best
}

function findCityByText(query: string): MockCity[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  return MOCK_CITIES.filter(
    (city) =>
      city.name.toLowerCase().includes(normalized) ||
      city.state.toLowerCase() === normalized ||
      `${city.name.toLowerCase()}, ${city.state.toLowerCase()}`.includes(normalized),
  )
}

function toResolvedAddress(city: MockCity, overrides: Partial<ResolvedAddress> = {}): ResolvedAddress {
  return {
    line1: undefined,
    city: city.name,
    state: city.state,
    postal: '00000',
    country: 'US',
    lat: city.lat,
    lng: city.lng,
    placeId: placeIdOf(city),
    timezone: city.timezone,
    ...overrides,
  }
}

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const EARTH_RADIUS_MILES = 3958.8
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.sqrt(h))
}

/** Standard Google polyline encoding, level-5 precision — decodes fine in real map libraries. */
function encodePolyline(points: Array<{ lat: number; lng: number }>): string {
  let output = ''
  let prevLat = 0
  let prevLng = 0

  const encodeValue = (value: number): string => {
    let v = value < 0 ? ~(value << 1) : value << 1
    let result = ''
    while (v >= 0x20) {
      result += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    result += String.fromCharCode(v + 63)
    return result
  }

  for (const point of points) {
    const lat = Math.round(point.lat * 1e5)
    const lng = Math.round(point.lng * 1e5)
    output += encodeValue(lat - prevLat) + encodeValue(lng - prevLng)
    prevLat = lat
    prevLng = lng
  }
  return output
}

const ROAD_FACTOR = 1.18
const BASE_AVERAGE_MPH = 52
const RESTRICTED_AVERAGE_MPH = 45
const POINTS_PER_LEG = 6

function averageMph(profile: RouteRequest['vehicleProfile']): number {
  if (!profile) return BASE_AVERAGE_MPH
  const restricted = profile.overweight || profile.overheight || profile.overwidth || profile.overlength
  return restricted ? RESTRICTED_AVERAGE_MPH : BASE_AVERAGE_MPH
}

function interpolate(a: RouteWaypoint, b: RouteWaypoint, steps: number): RouteWaypoint[] {
  const points: RouteWaypoint[] = []
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    points.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t })
  }
  return points
}

const geocodeMemo = new Map<string, ResolvedAddress>()

export class MockGeoAdapter implements GeoProvider {
  readonly name = PROVIDER_NAME

  async autocomplete(query: string, _sessionToken: string): Promise<PlaceSuggestion[]> {
    return findCityByText(query)
      .slice(0, 8)
      .map((city) => ({
        placeId: placeIdOf(city),
        description: `${city.name}, ${city.state}`,
        mainText: city.name,
        secondaryText: city.state,
      }))
  }

  async resolvePlace(placeId: string): Promise<ResolvedAddress> {
    const city = cityFromPlaceId(placeId)
    if (!city) {
      throw new Error(`Unknown mock place id: ${placeId}`)
    }
    return toResolvedAddress(city)
  }

  /**
   * Geocodes free text against the offline city dataset. Memoized in-process
   * per literal input string — geocoding the same address text twice inside
   * one request is wasted work even against a mock, and this is the one
   * cache the design rule allows an adapter to keep for itself.
   */
  async geocode(freeText: string): Promise<ResolvedAddress> {
    const cached = geocodeMemo.get(freeText)
    if (cached) return cached

    const matches = findCityByText(freeText)
    let resolved: ResolvedAddress
    if (matches.length > 0) {
      resolved = toResolvedAddress(matches[0])
    } else {
      // No dataset match: deterministically anchor near a city derived from a
      // hash of the input, jittered a little so distinct unknown addresses
      // don't all collapse onto the exact same point.
      const hash = deterministicHash(freeText)
      const base = MOCK_CITIES[hash % MOCK_CITIES.length]
      const jitterLat = ((hash % 1000) / 1000 - 0.5) * 0.5
      const jitterLng = (((hash >> 3) % 1000) / 1000 - 0.5) * 0.5
      resolved = toResolvedAddress(base, {
        lat: base.lat + jitterLat,
        lng: base.lng + jitterLng,
        placeId: undefined,
      })
    }
    geocodeMemo.set(freeText, resolved)
    return resolved
  }

  async timezoneAt(lat: number, lng: number, _at: Date): Promise<string> {
    return findNearestCity(lat, lng).timezone
  }

  async route(request: RouteRequest): Promise<RouteResult> {
    const { waypoints } = request
    if (waypoints.length < 2) {
      throw new Error('route() requires at least an origin and a destination')
    }

    const mph = averageMph(request.vehicleProfile)
    const legs: RouteLeg[] = []
    const polylinePoints: RouteWaypoint[] = [waypoints[0]]
    let totalMiles = 0
    let totalMinutes = 0

    for (let i = 0; i < waypoints.length - 1; i += 1) {
      const from = waypoints[i]
      const to = waypoints[i + 1]
      const miles = Math.round(haversineMiles(from, to) * ROAD_FACTOR * 10) / 10
      const minutes = Math.round((miles / mph) * 60)
      legs.push({ fromIndex: i, toIndex: i + 1, miles, durationMinutes: minutes })
      polylinePoints.push(...interpolate(from, to, POINTS_PER_LEG))
      totalMiles += miles
      totalMinutes += minutes
    }

    const states = this.statesTraversed(waypoints)

    return {
      totalMiles: Math.round(totalMiles * 10) / 10,
      durationMinutes: totalMinutes,
      polyline: encodePolyline(polylinePoints),
      legs,
      states,
    }
  }

  private statesTraversed(waypoints: RouteWaypoint[]): StateCode[] {
    const perWaypointStates = waypoints.map((wp) => findNearestCity(wp.lat, wp.lng).state)
    const states: StateCode[] = [perWaypointStates[0]]
    for (let i = 1; i < perWaypointStates.length; i += 1) {
      const segment = statesBetween(perWaypointStates[i - 1], perWaypointStates[i])
      for (const s of segment.slice(1)) states.push(s)
    }
    return states.filter((s, i) => i === 0 || s !== states[i - 1])
  }
}

/** Test/seed helper: look up a mock city's coordinates by name (case-insensitive, exact). */
export function mockCityWaypoint(name: string): RouteWaypoint & { state: StateCode; timezone: string } {
  const city = MOCK_CITIES.find((c) => c.name.toLowerCase() === name.toLowerCase())
  if (!city) throw new Error(`No mock city named "${name}" — see MOCK_CITIES in geo/mock-adapter.ts`)
  return { lat: city.lat, lng: city.lng, label: city.name, state: city.state, timezone: city.timezone }
}
