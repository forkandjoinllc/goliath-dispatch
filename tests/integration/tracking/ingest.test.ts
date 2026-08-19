import { beforeEach, describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { loadStops, loads, trackingEvents, trackingSessions } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { NormalizedTrackingEvent } from '@/integrations/tracking'
import { ingestEvents } from '@/server/tracking/ingest'
import {
  createTestCarrier,
  createTestCustomer,
  createTestDriverWithConsent,
  createTestLoad,
  createTestMembership,
  createTestTenant,
  createTestUser,
  houstonToDallasWaypoints,
  setStopCoordinates,
} from './fixtures'

/**
 * `ingestEvents` is the write path a real webhook (or the mock simulator)
 * drives through. These tests exercise it directly against Postgres —
 * idempotency and stop-arrival side effects both depend on the actual
 * `tracking_events` unique constraint and `load_stops`/`load_status_history`
 * rows, which a pure unit test cannot observe.
 */

async function setUp() {
  const tenant = await createTestTenant()
  const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
  await createTestMembership(tenant.id, admin.id, 'admin')
  const db = tenantDb(tenant.id)

  const carrier = await createTestCarrier(db, admin.id)
  const customer = await createTestCustomer(db, { userId: admin.id })
  const { load } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, {
    customerId: customer.id,
    carrierId: carrier.id,
  })
  await setStopCoordinates(db, load.id, houstonToDallasWaypoints())

  // Real dispatch requires clearing the full `evaluateLoadForDispatch`
  // compliance gate (carrier docs, driver verification, equipment,
  // schedule…) — none of which this suite is testing. Seeding the load
  // straight to `dispatched` isolates what's actually under test: whether
  // `ingestEvents` drives the status machine correctly *from* `dispatched`
  // onward, via the same `transitionStatus` call a real dispatch would use.
  await db.update(loads, load.id, { status: 'dispatched' })
  const stops = await db.findMany(loadStops, { where: eq(loadStops.loadId, load.id) })
  const pickup = stops.find((s) => s.stopType === 'pickup')!
  const delivery = stops.find((s) => s.stopType === 'delivery')!

  const { driver } = await createTestDriverWithConsent(db)

  const session = await db.insert(trackingSessions, {
    loadId: load.id,
    driverId: driver.id,
    provider: 'mock',
    providerSessionId: 'mock-session-1',
    consentGrantedAt: new Date(),
    startedAt: new Date(),
    healthStatus: 'healthy',
  })

  return { db, load, pickup, delivery, session }
}

function event(
  overrides: Partial<NormalizedTrackingEvent> & Pick<NormalizedTrackingEvent, 'eventType' | 'rawProviderReference'>,
): NormalizedTrackingEvent {
  return {
    sessionId: 'provider-session-1',
    provider: 'mock',
    occurredAt: new Date(),
    ...overrides,
  }
}

describe('ingestEvents — idempotency', () => {
  let ctx: Awaited<ReturnType<typeof setUp>>

  beforeEach(async () => {
    ctx = await setUp()
  })

  it('inserts a new event and reports it as ingested, not a duplicate', async () => {
    const result = await ingestEvents(ctx.db, ctx.session.id, [
      event({ eventType: 'session_started', rawProviderReference: 'evt-1' }),
    ])
    expect(result).toEqual({ ingested: 1, duplicates: 0 })

    const rows = await ctx.db.findMany(trackingEvents, { where: eq(trackingEvents.sessionId, ctx.session.id) })
    expect(rows).toHaveLength(1)
  })

  it('is a no-op — not a partial failure — when the exact same provider reference is submitted again', async () => {
    const first = event({ eventType: 'session_started', rawProviderReference: 'evt-idempotent' })
    await ingestEvents(ctx.db, ctx.session.id, [first])

    const second = await ingestEvents(ctx.db, ctx.session.id, [first])
    expect(second).toEqual({ ingested: 0, duplicates: 1 })

    const rows = await ctx.db.findMany(trackingEvents, { where: eq(trackingEvents.sessionId, ctx.session.id) })
    expect(rows).toHaveLength(1)
  })

  it('ingests only the new events in a batch that mixes previously-seen and new references', async () => {
    await ingestEvents(ctx.db, ctx.session.id, [event({ eventType: 'session_started', rawProviderReference: 'evt-a' })])

    const result = await ingestEvents(ctx.db, ctx.session.id, [
      event({ eventType: 'session_started', rawProviderReference: 'evt-a' }),
      event({ eventType: 'location_update', rawProviderReference: 'evt-b', lat: 30, lng: -96 }),
    ])
    expect(result).toEqual({ ingested: 1, duplicates: 1 })
  })

  it('resubmitting a whole prior batch out of order still only inserts the truly-new references once', async () => {
    const batch1 = [event({ eventType: 'session_started', rawProviderReference: 'evt-1' })]
    await ingestEvents(ctx.db, ctx.session.id, batch1)

    // Re-post the exact same batch (as a real provider retry would) three times.
    await ingestEvents(ctx.db, ctx.session.id, batch1)
    const third = await ingestEvents(ctx.db, ctx.session.id, batch1)
    expect(third.ingested).toBe(0)

    const rows = await ctx.db.findMany(trackingEvents, { where: eq(trackingEvents.sessionId, ctx.session.id) })
    expect(rows).toHaveLength(1)
  })
})

describe('ingestEvents — geofence / stop arrival side effects', () => {
  let ctx: Awaited<ReturnType<typeof setUp>>

  beforeEach(async () => {
    ctx = await setUp()
  })

  it('records the pickup stop arrival exactly once on the first arrived_pickup event', async () => {
    const arrivalTime = new Date()
    await ingestEvents(ctx.db, ctx.session.id, [
      event({ eventType: 'arrived_pickup', rawProviderReference: 'arrive-1', stopId: ctx.pickup.id, occurredAt: arrivalTime }),
    ])

    const stopAfterFirst = (await ctx.db.findMany(loadStops, { where: eq(loadStops.id, ctx.pickup.id) }))[0]!
    expect(stopAfterFirst.actualArrivalAt?.getTime()).toBe(arrivalTime.getTime())

    // A second, later arrival event for the same stop must not overwrite the first arrival time.
    const laterTime = new Date(arrivalTime.getTime() + 5 * 60_000)
    await ingestEvents(ctx.db, ctx.session.id, [
      event({ eventType: 'geofence_enter', rawProviderReference: 'arrive-2', stopId: ctx.pickup.id, occurredAt: laterTime }),
    ])

    const stopAfterSecond = (await ctx.db.findMany(loadStops, { where: eq(loadStops.id, ctx.pickup.id) }))[0]!
    expect(stopAfterSecond.actualArrivalAt?.getTime()).toBe(arrivalTime.getTime())
  })

  it('advances the load status as each event arrives, and stops advancing once delivered', async () => {
    const t0 = Date.now()
    await ingestEvents(ctx.db, ctx.session.id, [
      event({ eventType: 'session_started', rawProviderReference: 'e1', occurredAt: new Date(t0) }),
    ])
    let load = await ctx.db.findById(loads, ctx.load.id)
    expect(load!.status).toBe('en_route_to_pickup')

    await ingestEvents(ctx.db, ctx.session.id, [
      event({ eventType: 'arrived_pickup', rawProviderReference: 'e2', stopId: ctx.pickup.id, occurredAt: new Date(t0 + 60_000) }),
    ])
    load = await ctx.db.findById(loads, ctx.load.id)
    expect(load!.status).toBe('at_pickup')

    await ingestEvents(ctx.db, ctx.session.id, [
      event({ eventType: 'departed_pickup', rawProviderReference: 'e3', stopId: ctx.pickup.id, occurredAt: new Date(t0 + 120_000) }),
    ])
    load = await ctx.db.findById(loads, ctx.load.id)
    expect(load!.status).toBe('in_transit')

    await ingestEvents(ctx.db, ctx.session.id, [
      event({ eventType: 'arrived_delivery', rawProviderReference: 'e4', stopId: ctx.delivery.id, occurredAt: new Date(t0 + 180_000) }),
    ])
    load = await ctx.db.findById(loads, ctx.load.id)
    expect(load!.status).toBe('at_delivery')

    // `departed_delivery` records the departure but never transitions the load past `at_delivery` —
    // POD is a document event, not a location one.
    await ingestEvents(ctx.db, ctx.session.id, [
      event({ eventType: 'departed_delivery', rawProviderReference: 'e5', stopId: ctx.delivery.id, occurredAt: new Date(t0 + 240_000) }),
    ])
    load = await ctx.db.findById(loads, ctx.load.id)
    expect(load!.status).toBe('at_delivery')

    const deliveryStop = (await ctx.db.findMany(loadStops, { where: eq(loadStops.id, ctx.delivery.id) }))[0]!
    expect(deliveryStop.actualDepartureAt).not.toBeNull()
  })

  it('is idempotent even when the duplicate event would otherwise re-trigger a status transition', async () => {
    const t0 = Date.now()
    const arrive = event({ eventType: 'arrived_pickup', rawProviderReference: 'dup-1', stopId: ctx.pickup.id, occurredAt: new Date(t0) })
    await ingestEvents(ctx.db, ctx.session.id, [arrive])

    // Resubmitting the identical reference must not throw even though the load has already left `at_pickup`-eligible statuses behind.
    const result = await ingestEvents(ctx.db, ctx.session.id, [arrive])
    expect(result).toEqual({ ingested: 0, duplicates: 1 })
  })
})
