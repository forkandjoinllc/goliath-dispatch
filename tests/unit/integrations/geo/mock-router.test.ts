import { describe, expect, it } from 'vitest'
import { MockGeoAdapter, mockCityWaypoint } from '@/integrations/geo/mock-adapter'
import { statesBetween } from '@/integrations/geo/states'

describe('MockGeoAdapter.route', () => {
  const adapter = new MockGeoAdapter()

  it('produces a deterministic mileage and duration for the same waypoints', async () => {
    const houston = mockCityWaypoint('Houston')
    const dallas = mockCityWaypoint('Dallas')

    const first = await adapter.route({ waypoints: [houston, dallas] })
    const second = await adapter.route({ waypoints: [houston, dallas] })

    expect(second.totalMiles).toBe(first.totalMiles)
    expect(second.durationMinutes).toBe(first.durationMinutes)
    expect(second.polyline).toBe(first.polyline)
    expect(first.totalMiles).toBeGreaterThan(0)
  })

  it('slows the average speed and lengthens duration for a restricted (oversize) vehicle profile', async () => {
    const houston = mockCityWaypoint('Houston')
    const dallas = mockCityWaypoint('Dallas')

    const normal = await adapter.route({ waypoints: [houston, dallas] })
    const restricted = await adapter.route({
      waypoints: [houston, dallas],
      vehicleProfile: { overweight: true },
    })

    expect(restricted.totalMiles).toBe(normal.totalMiles)
    expect(restricted.durationMinutes).toBeGreaterThan(normal.durationMinutes)
  })

  it('produces a plausible ordered, deduplicated list of traversed states', async () => {
    const houston = mockCityWaypoint('Houston')
    const nyc = mockCityWaypoint('New York')

    const route = await adapter.route({ waypoints: [houston, nyc] })

    expect(route.states[0]).toBe('TX')
    expect(route.states[route.states.length - 1]).toBe('NY')
    // No two consecutive entries are the same state.
    for (let i = 1; i < route.states.length; i += 1) {
      expect(route.states[i]).not.toBe(route.states[i - 1])
    }
  })

  it('returns legs that sum to the total mileage and duration', async () => {
    const houston = mockCityWaypoint('Houston')
    const dallas = mockCityWaypoint('Dallas')
    const chicago = mockCityWaypoint('Chicago')

    const route = await adapter.route({ waypoints: [houston, dallas, chicago] })

    expect(route.legs).toHaveLength(2)
    const legMiles = route.legs.reduce((sum, leg) => sum + leg.miles, 0)
    const legMinutes = route.legs.reduce((sum, leg) => sum + leg.durationMinutes, 0)
    expect(Math.round(legMiles * 10) / 10).toBeCloseTo(route.totalMiles, 1)
    expect(legMinutes).toBe(route.durationMinutes)
  })
})

describe('statesBetween', () => {
  it('returns a single state when origin and destination match', () => {
    expect(statesBetween('TX', 'TX')).toEqual(['TX'])
  })

  it('returns a direct path for adjacent states', () => {
    expect(statesBetween('TX', 'OK')).toEqual(['TX', 'OK'])
  })

  it('finds a plausible chain through non-adjacent states', () => {
    const path = statesBetween('TX', 'NY')
    expect(path[0]).toBe('TX')
    expect(path[path.length - 1]).toBe('NY')
    expect(path.length).toBeGreaterThan(2)
  })

  it('degrades to the two endpoints when no land path exists', () => {
    expect(statesBetween('HI', 'CA')).toEqual(['HI', 'CA'])
  })
})

describe('MockGeoAdapter.geocode', () => {
  const adapter = new MockGeoAdapter()

  it('resolves a known city deterministically', async () => {
    const first = await adapter.geocode('Denver, CO')
    const second = await adapter.geocode('Denver, CO')
    expect(first).toEqual(second)
    expect(first.state).toBe('CO')
  })

  it('still returns a usable address for free text outside the dataset', async () => {
    const resolved = await adapter.geocode('123 Nowhere Rd, Smallville')
    expect(resolved.lat).toBeTypeOf('number')
    expect(resolved.lng).toBeTypeOf('number')
    expect(resolved.state).toBeDefined()
  })
})
