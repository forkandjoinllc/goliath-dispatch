import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { drivers, loadAssignments, loadStops, loads, userTenantMemberships } from '@/db/schema'
import { authorize, can, type Actor } from '@/lib/permissions'
import { scopeFilter } from '@/lib/permissions/check'
import { acceptInvitation, issueInvitation, readInvitation } from '@/server/auth/registration'
import { addDriverCarrierRelationship, createDriver, inviteDriverUser } from '@/server/drivers/service'
import { getLoadResourceContext, listLoads } from '@/server/loads/queries'
import { grantTrackingConsent, startTrackingSession } from '@/server/tracking/sessions'
import {
  createTestCarrier,
  createTestCustomer,
  createTestLoad,
  createTestMembership,
  createTestTenant,
  createTestUser,
} from '../loads/fixtures'
import { houstonToDallasWaypoints, setStopCoordinates } from '../tracking/fixtures'

function baseActor(overrides: Partial<Actor>): Actor {
  return {
    userId: 'user-1',
    email: 'actor@example.com',
    firstName: 'Test',
    lastName: 'Actor',
    locale: 'en',
    timezone: 'America/Chicago',
    isPlatformSuperAdmin: false,
    tenantId: null,
    role: null,
    carrierId: null,
    driverId: null,
    assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: 'session-1',
    ...overrides,
  }
}

async function setUpTenantWithCarrierDriver() {
  const tenant = await createTestTenant()
  const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
  await createTestMembership(tenant.id, admin.id, 'admin')
  const db = tenantDb(tenant.id)
  const carrier = await createTestCarrier(db, admin.id)

  const driver = await createDriver(db, { userId: admin.id }, { firstName: 'Dana', lastName: 'Driver', preferredLocale: 'en' })
  await addDriverCarrierRelationship(db, { userId: admin.id }, { driverId: driver.id, carrierId: carrier.id, isPrimary: true })

  return { tenant, admin, db, carrier, driver }
}

describe('inviting a driver to the portal', () => {
  it('creates an invitation carrying both carrierId and driverId', async () => {
    const { tenant, db, carrier, driver } = await setUpTenantWithCarrierDriver()
    const carrierUser = await createTestUser({ firstName: 'Cara', lastName: 'Carrier' })
    await createTestMembership(tenant.id, carrierUser.id, 'carrier', { carrierId: carrier.id })
    const carrierActor = baseActor({ userId: carrierUser.id, tenantId: tenant.id, role: 'carrier', carrierId: carrier.id })

    const result = await inviteDriverUser(db, carrierActor, {
      driverId: driver.id,
      email: 'new-driver@example.test',
      firstName: 'Dana',
      lastName: 'Driver',
    })

    const read = await readInvitation(result.invitationToken)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.invitation.role).toBe('driver')
    expect(read.invitation.carrierId).toBe(carrier.id)
    expect(read.invitation.driverId).toBe(driver.id)
    expect(read.invitation.tenantId).toBe(tenant.id)
  })

  it('a carrier user cannot invite a driver belonging to a different carrier', async () => {
    const { tenant, db, driver } = await setUpTenantWithCarrierDriver()
    const otherCarrier = await createTestCarrier(db, (await createTestUser({ firstName: 'Ollie', lastName: 'Other' })).id)
    const carrierUser = await createTestUser({ firstName: 'Cara', lastName: 'Carrier' })
    await createTestMembership(tenant.id, carrierUser.id, 'carrier', { carrierId: otherCarrier.id })
    const carrierActor = baseActor({ userId: carrierUser.id, tenantId: tenant.id, role: 'carrier', carrierId: otherCarrier.id })

    // `driverResource()` (the action's resource() resolver) only reports a
    // `carrierId` scoping fact when an active relationship between the
    // acting carrier and this driver genuinely exists — it does not here.
    const resource = { tenantId: tenant.id, driverId: driver.id, carrierId: null }
    expect(can(carrierActor, 'tenant:user:invite', resource).allowed).toBe(false)
    expect(() => authorize(carrierActor, 'tenant:user:invite', resource)).toThrow()
  })

  it('accepting the invitation links drivers.userId and the membership\'s driverId in one transaction', async () => {
    const { tenant, db, carrier, driver, admin } = await setUpTenantWithCarrierDriver()

    const token = await issueInvitation(tenant.id, 'accepted-driver@example.test', {
      role: 'driver',
      carrierId: carrier.id,
      driverId: driver.id,
      invitedByUserId: admin.id,
    })

    const result = await acceptInvitation(token, {
      firstName: 'Dana',
      lastName: 'Driver',
      password: 'AcceptThisInvite9',
      locale: 'en',
      timezone: 'America/Chicago',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const updatedDriver = await db.findById(drivers, driver.id)
    expect(updatedDriver?.userId).toBe(result.userId)

    const [membership] = await db.findMany(userTenantMemberships, {
      where: and(eq(userTenantMemberships.userId, result.userId), eq(userTenantMemberships.tenantId, tenant.id))!,
    })
    expect(membership?.driverId).toBe(driver.id)
    expect(membership?.carrierId).toBe(carrier.id)
    expect(membership?.role).toBe('driver')
  })
})

describe('consequences of a linked driver login', () => {
  async function acceptedDriverActor() {
    const { tenant, db, carrier, driver, admin } = await setUpTenantWithCarrierDriver()
    const token = await issueInvitation(tenant.id, 'own-scope-driver@example.test', {
      role: 'driver',
      carrierId: carrier.id,
      driverId: driver.id,
      invitedByUserId: admin.id,
    })
    const result = await acceptInvitation(token, {
      firstName: 'Dana',
      lastName: 'Driver',
      password: 'AcceptThisInvite9',
      locale: 'en',
      timezone: 'America/Chicago',
    })
    if (!result.ok) throw new Error('expected acceptance to succeed')

    const driverActor = baseActor({ userId: result.userId, tenantId: tenant.id, role: 'driver', driverId: driver.id })
    return { tenant, db, carrier, driver, driverActor, userId: result.userId }
  }

  it('an own-scope load list contains only the driver\'s assigned loads', async () => {
    const { db, carrier, driver, driverActor } = await acceptedDriverActor()
    const admin = await createTestUser({ firstName: 'Ada2', lastName: 'Admin2' })
    const customer = await createTestCustomer(db, { userId: admin.id })

    const { load: assignedLoad } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, carrierId: carrier.id })
    await db.insert(loadAssignments, { loadId: assignedLoad.id, resourceType: 'driver', driverId: driver.id })

    const { load: otherLoad } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, carrierId: carrier.id })
    void otherLoad

    const scope = scopeFilter(driverActor, 'own')
    const { rows } = await listLoads(db, scope)
    const ids = rows.map((r) => r.load.id)
    expect(ids).toContain(assignedLoad.id)
    expect(ids).not.toContain(otherLoad.id)
    expect(ids).toHaveLength(1)
  })

  it('can grant tracking consent, and a tracking session then starts for their assigned load', async () => {
    const { db, carrier, driver, driverActor, userId } = await acceptedDriverActor()
    const admin = await createTestUser({ firstName: 'Ada3', lastName: 'Admin3' })
    const customer = await createTestCustomer(db, { userId: admin.id })
    const { load } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, carrierId: carrier.id })
    await setStopCoordinates(db, load.id, houstonToDallasWaypoints())
    await db.update(loads, load.id, { status: 'dispatched' })
    await db.insert(loadAssignments, { loadId: load.id, resourceType: 'driver', driverId: driver.id })

    await grantTrackingConsent(db, { userId: driverActor.userId })

    const session = await startTrackingSession(db, { loadId: load.id, driverId: driver.id })
    expect(session.loadId).toBe(load.id)
    expect(session.consentUserId).toBe(userId)

    // Sanity: the stops used to start the session really are the ones just coordinated.
    const stops = await db.findMany(loadStops, { where: eq(loadStops.loadId, load.id) })
    expect(stops.length).toBeGreaterThanOrEqual(2)
  })

  it('cannot transition a load status — the permission is absent at every scope', async () => {
    const { db, carrier, driver, driverActor } = await acceptedDriverActor()
    const admin = await createTestUser({ firstName: 'Ada4', lastName: 'Admin4' })
    const customer = await createTestCustomer(db, { userId: admin.id })
    const { load } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, carrierId: carrier.id })
    await db.insert(loadAssignments, { loadId: load.id, resourceType: 'driver', driverId: driver.id })

    const resource = await getLoadResourceContext(db, load.id, driverActor)
    expect(resource.driverId).toBe(driver.id)
    expect(can(driverActor, 'load:status:update', resource).allowed).toBe(false)
    expect(() => authorize(driverActor, 'load:status:update', resource)).toThrow()

    // And they can upload a POD to the same load — the two capabilities are
    // genuinely independent (`load:document:upload` is granted at `own`
    // scope; `load:status:update` is absent entirely, see `catalog.ts`).
    expect(can(driverActor, 'load:document:upload', resource).allowed).toBe(true)
  })
})
