import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { carrierDispatcherAssignments } from '@/db/schema'
import { createTruck } from '@/server/equipment/service'
import { listTrucks } from '@/server/equipment/queries'
import { can, scopeFilter, type Actor } from '@/lib/permissions'
import { createTestCarrier, createTestTenant, createTestUser, uniqueVin } from './fixtures'

function dispatcherActor(tenantId: string, userId: string, assignedCarrierIds: string[]): Actor {
  return {
    userId,
    email: 'dispatcher@example.test',
    firstName: 'Dee',
    lastName: 'Dispatcher',
    locale: 'en',
    timezone: 'America/Chicago',
    isPlatformSuperAdmin: false,
    tenantId,
    role: 'dispatcher',
    carrierId: null,
    driverId: null,
    assignments: { carrierIds: assignedCarrierIds, truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: null,
  }
}

describe('equipment dispatcher scope', () => {
  it('cannot read a truck belonging to an unassigned carrier, at either the single-record or list level', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dispatcherUser = await createTestUser({ firstName: 'Dee', lastName: 'Dispatcher' })
    const db = tenantDb(tenant.id)

    const assignedCarrier = await createTestCarrier(db, admin.id)
    const otherCarrier = await createTestCarrier(db, admin.id)

    const assignedTruck = await createTruck(db, { userId: admin.id }, {
      carrierId: assignedCarrier.id,
      unitNumber: '600',
      vin: uniqueVin(),
    })
    const otherTruck = await createTruck(db, { userId: admin.id }, {
      carrierId: otherCarrier.id,
      unitNumber: '601',
      vin: uniqueVin(),
    })

    await db.insert(carrierDispatcherAssignments, {
      carrierId: assignedCarrier.id,
      dispatcherUserId: dispatcherUser.id,
      isPrimary: true,
      assignedByUserId: admin.id,
    })

    const dispatcher = dispatcherActor(tenant.id, dispatcherUser.id, [assignedCarrier.id])

    const decisionForAssigned = can(dispatcher, 'equipment:read', { tenantId: tenant.id, carrierId: assignedCarrier.id })
    const decisionForOther = can(dispatcher, 'equipment:read', { tenantId: tenant.id, carrierId: otherCarrier.id })
    expect(decisionForAssigned.allowed).toBe(true)
    expect(decisionForOther.allowed).toBe(false)
    expect(decisionForOther.reasonKey).toBe('errors.outOfScope')

    // The list query itself must not even return the truck outside scope.
    const scope = scopeFilter(dispatcher, 'assigned')
    const { rows } = await listTrucks(db, scope)
    const visibleIds = rows.map((t) => t.id)
    expect(visibleIds).toContain(assignedTruck.id)
    expect(visibleIds).not.toContain(otherTruck.id)
  })
})
