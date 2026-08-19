import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { authorize, can, type Actor } from '@/lib/permissions'
import { getLoadResourceContext } from '@/server/loads/queries'
import { transitionStatus } from '@/server/loads/service'
import { createTestCarrier, createTestCustomer, createTestLoad, createTestTenant, createTestUser } from './fixtures'

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

describe('scope permissions — reading a load', () => {
  it('a dispatcher not assigned to the load\'s carrier cannot read it; one who is assigned can', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const adminActor = { userId: admin.id, role: 'admin' as const }

    const customer = await createTestCustomer(db, { userId: admin.id })
    const assignedCarrier = await createTestCarrier(db, admin.id)
    const otherCarrier = await createTestCarrier(db, admin.id)
    const { load } = await createTestLoad(db, adminActor, { customerId: customer.id, carrierId: assignedCarrier.id })

    const dispatcherUser = await createTestUser({ firstName: 'Dana', lastName: 'Dispatcher' })
    const unassignedDispatcher = baseActor({
      userId: dispatcherUser.id,
      tenantId: tenant.id,
      role: 'dispatcher',
      assignments: { carrierIds: [otherCarrier.id], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    })
    const assignedDispatcher = baseActor({
      userId: dispatcherUser.id,
      tenantId: tenant.id,
      role: 'dispatcher',
      assignments: { carrierIds: [assignedCarrier.id], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    })

    const resource = await getLoadResourceContext(db, load.id, unassignedDispatcher)
    expect(resource.carrierId).toBe(assignedCarrier.id)

    const deniedDecision = can(unassignedDispatcher, 'load:read', resource)
    expect(deniedDecision.allowed).toBe(false)
    expect(() => authorize(unassignedDispatcher, 'load:read', resource)).toThrow()

    const allowedDecision = can(assignedDispatcher, 'load:read', resource)
    expect(allowedDecision.allowed).toBe(true)
    expect(allowedDecision.scope).toBe('assigned')
    expect(() => authorize(assignedDispatcher, 'load:read', resource)).not.toThrow()
  })
})

describe('scope permissions — transitioning status', () => {
  it('a driver holds no load:status:update grant at any scope, and is refused before the status machine even runs', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const adminActor = { userId: admin.id, role: 'admin' as const }

    const customer = await createTestCustomer(db, { userId: admin.id })
    const carrier = await createTestCarrier(db, admin.id)
    const { load } = await createTestLoad(db, adminActor, { customerId: customer.id, carrierId: carrier.id })

    const driverUser = await createTestUser({ firstName: 'Dana', lastName: 'Driver' })
    const driverActor = baseActor({
      userId: driverUser.id,
      tenantId: tenant.id,
      role: 'driver',
      driverId: crypto.randomUUID(),
    })

    const resource = await getLoadResourceContext(db, load.id, driverActor)

    const decision = can(driverActor, 'load:status:update', resource)
    expect(decision.allowed).toBe(false)
    expect(decision.reasonKey).toBe('errors.permissionDenied')
    expect(() => authorize(driverActor, 'load:status:update', resource)).toThrow()

    // The status machine itself never sees this request — the permission
    // check in the action layer refuses it first. Confirm the load is
    // untouched: a legal transition still succeeds when actually invoked
    // by an authorized actor, so the refusal above was about permission,
    // not the transition itself.
    const result = await transitionStatus(db, adminActor, { ipAddress: null, userAgent: null }, { loadId: load.id, to: 'available' })
    expect(result.status).toBe('available')
  })
})
