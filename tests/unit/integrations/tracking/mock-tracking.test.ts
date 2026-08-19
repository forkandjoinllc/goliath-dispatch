import { beforeEach, describe, expect, it } from 'vitest'
import { MockTrackingAdapter, resetMockTrackingSessions } from '@/integrations/tracking/mock-adapter'
import { MockGeoAdapter, mockCityWaypoint } from '@/integrations/geo/mock-adapter'
import type { TrackingStop } from '@/integrations/tracking/types'

const geo = new MockGeoAdapter()

async function buildSession() {
  const houston = mockCityWaypoint('Houston')
  const dallas = mockCityWaypoint('Dallas')
  const route = await geo.route({ waypoints: [houston, dallas] })

  const stops: TrackingStop[] = [
    { stopId: 'stop-pickup', type: 'pickup', lat: houston.lat, lng: houston.lng, waypointIndex: 0 },
    { stopId: 'stop-delivery', type: 'delivery', lat: dallas.lat, lng: dallas.lng, waypointIndex: 1 },
  ]

  const adapter = new MockTrackingAdapter()
  const started = await adapter.startSession(
    { loadId: 'load-1', driverPhone: '+15125551234', consentGranted: true, stops },
    { route, startedAt: new Date('2026-01-01T12:00:00Z') },
  )
  return { adapter, started, route }
}

describe('MockTrackingAdapter', () => {
  beforeEach(() => resetMockTrackingSessions())

  it('refuses to start a session without consent', async () => {
    const adapter = new MockTrackingAdapter()
    const houston = mockCityWaypoint('Houston')
    const dallas = mockCityWaypoint('Dallas')
    const route = await geo.route({ waypoints: [houston, dallas] })
    await expect(
      adapter.startSession(
        {
          loadId: 'load-1',
          driverPhone: '+15125551234',
          consentGranted: false,
          stops: [
            { stopId: 's1', type: 'pickup', lat: houston.lat, lng: houston.lng, waypointIndex: 0 },
            { stopId: 's2', type: 'delivery', lat: dallas.lat, lng: dallas.lng, waypointIndex: 1 },
          ],
        },
        { route },
      ),
    ).rejects.toThrow()
  })

  it('emits session_started and consent_granted immediately', async () => {
    const { adapter, started } = await buildSession()
    const events = await adapter.pollEvents(started.sessionId, null)
    expect(events[0].eventType).toBe('session_started')
    expect(events[1].eventType).toBe('consent_granted')
  })

  it('produces a monotonically increasing event stream as time advances', async () => {
    const { adapter, started } = await buildSession()

    adapter.advance(started.sessionId, 30) // arrive at pickup + dwell starts
    adapter.advance(started.sessionId, 60)
    adapter.advance(started.sessionId, 600) // enough to reach delivery for a ~240mi lane

    const events = await adapter.pollEvents(started.sessionId, null)
    expect(events.length).toBeGreaterThan(2)
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].occurredAt.getTime()).toBeGreaterThanOrEqual(events[i - 1].occurredAt.getTime())
    }
    expect(events.some((e) => e.eventType === 'arrived_pickup')).toBe(true)
    expect(events.some((e) => e.eventType === 'departed_pickup')).toBe(true)
    expect(events.some((e) => e.eventType === 'location_update')).toBe(true)
  })

  it('advance() includes the t=0 events (session_started, consent_granted) on the very first call', async () => {
    const { adapter, started } = await buildSession()

    const firstBatch = adapter.advance(started.sessionId, 5)

    expect(firstBatch.some((e) => e.eventType === 'session_started')).toBe(true)
    expect(firstBatch.some((e) => e.eventType === 'consent_granted')).toBe(true)

    // And a second call never repeats them.
    const secondBatch = adapter.advance(started.sessionId, 5)
    expect(secondBatch.some((e) => e.eventType === 'session_started')).toBe(false)
  })

  it('advance() returns only the newly-visible events for that call', async () => {
    const { adapter, started } = await buildSession()

    const firstBatch = adapter.advance(started.sessionId, 30)
    const secondBatch = adapter.advance(started.sessionId, 30)

    expect(firstBatch.length).toBeGreaterThan(0)
    const firstIds = new Set(firstBatch.map((e) => e.rawProviderReference))
    for (const event of secondBatch) {
      expect(firstIds.has(event.rawProviderReference)).toBe(false)
    }
  })

  it('pollEvents(since) is idempotent — repeated calls with the same cursor return the same events', async () => {
    const { adapter, started } = await buildSession()
    adapter.advance(started.sessionId, 45)

    const first = await adapter.pollEvents(started.sessionId, null)
    const cursor = first[first.length - 1].occurredAt

    adapter.advance(started.sessionId, 45)
    const sinceA = await adapter.pollEvents(started.sessionId, cursor)
    const sinceB = await adapter.pollEvents(started.sessionId, cursor)

    expect(sinceA.map((e) => e.rawProviderReference)).toEqual(sinceB.map((e) => e.rawProviderReference))
    expect(sinceA.every((e) => e.occurredAt.getTime() > cursor.getTime())).toBe(true)
  })

  it('reaches session_ended once fully advanced, and getSession reports 100% progress', async () => {
    const { adapter, started } = await buildSession()
    adapter.advance(started.sessionId, 100_000) // far beyond the route duration

    const health = await adapter.getSession(started.sessionId)
    expect(health.status).toBe('ended')
    expect(health.routeProgressPercent).toBe(100)
    expect(health.remainingMiles).toBe(0)

    const events = await adapter.pollEvents(started.sessionId, null)
    expect(events[events.length - 1].eventType).toBe('session_ended')
  })
})
