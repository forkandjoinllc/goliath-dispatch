import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { loads, trackingSessions } from '@/db/schema'
import { isAppError } from '@/lib/errors'
import { advanceMockSession, revokeTrackingConsent, startTrackingSession } from '@/server/tracking/sessions'
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
 * Full-stack tracking flow: consent is a hard gate, and once granted, the
 * mock provider's `advance()` — driven through the exact same `ingestEvents`
 * path a real webhook would use — carries the load from `dispatched`
 * through to `at_delivery` and stops there (POD, not location, delivers a
 * load in this system).
 */
async function setUpLoad() {
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
  await db.update(loads, load.id, { status: 'dispatched' })

  return { db, load }
}

describe('startTrackingSession — consent gate', () => {
  it('refuses to start a session for a driver who has not granted tracking consent', async () => {
    const { db, load } = await setUpLoad()
    const { driver } = await createTestDriverWithConsent(db, { withConsent: false })

    await expect(startTrackingSession(db, { loadId: load.id, driverId: driver.id })).rejects.toSatisfy(
      (error) => isAppError(error) && error.code === 'forbidden' && error.messageKey === 'errors.trackingConsentMissing',
    )

    const sessions = await db.findMany(trackingSessions, { where: eq(trackingSessions.loadId, load.id) })
    expect(sessions).toHaveLength(0)
  })

  it('starts a session once the driver has granted consent', async () => {
    const { db, load } = await setUpLoad()
    const { driver } = await createTestDriverWithConsent(db, { withConsent: true })

    const session = await startTrackingSession(db, { loadId: load.id, driverId: driver.id })
    expect(session.loadId).toBe(load.id)
    expect(session.provider).toBe('mock')
    expect(session.providerSessionId).toBeTruthy()
  })

  it('stops ingesting location the instant consent is revoked, by ending the open session', async () => {
    const { db, load } = await setUpLoad()
    const { driver, userId } = await createTestDriverWithConsent(db, { withConsent: true })
    const session = await startTrackingSession(db, { loadId: load.id, driverId: driver.id })

    await revokeTrackingConsent(db, { userId })

    const updated = await db.requireById(trackingSessions, session.id, 'trackingSession')
    expect(updated.endedAt).not.toBeNull()
    expect(updated.healthStatus).toBe('ended')
  })
})

describe('mock provider advance() → ingestEvents — full flow', () => {
  it('drives the load from dispatched through en_route_to_pickup, at_pickup, in_transit, to at_delivery — and stops there', async () => {
    const { db, load } = await setUpLoad()
    const { driver } = await createTestDriverWithConsent(db, { withConsent: true })
    const session = await startTrackingSession(db, { loadId: load.id, driverId: driver.id })

    // The mock's `advance()` clamps to the simulated route's total duration,
    // so one very large advance reaches the end of the route in a single call.
    const events = await advanceMockSession(db, session.id, 100_000)
    expect(events.length).toBeGreaterThan(0)

    const result = await ingestEvents(db, session.id, events)
    expect(result.ingested).toBe(events.length)
    expect(result.duplicates).toBe(0)

    const finalLoad = await db.requireById(loads, load.id, 'load')
    expect(finalLoad.status).toBe('at_delivery')

    // Re-ingesting the identical event batch (as a retried webhook would) is a pure no-op.
    const replay = await ingestEvents(db, session.id, events)
    expect(replay).toEqual({ ingested: 0, duplicates: events.length })

    const finalLoadAfterReplay = await db.requireById(loads, load.id, 'load')
    expect(finalLoadAfterReplay.status).toBe('at_delivery')
  })
})
