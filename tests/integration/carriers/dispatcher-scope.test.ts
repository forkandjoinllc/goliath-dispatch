import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { carrierDispatcherAssignments } from '@/db/schema'
import { createCarrier } from '@/server/carriers/service'
import { listCarriers } from '@/server/carriers/queries'
import { can, scopeFilter, type Actor } from '@/lib/permissions'
import { createTestTenant, createTestUser, minimalCarrierInput, newDot } from './fixtures'

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

describe('dispatcher scope', () => {
  it('cannot read or list a carrier they are not assigned to', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dispatcherUser = await createTestUser({ firstName: 'Dee', lastName: 'Dispatcher' })
    const db = tenantDb(tenant.id)

    const { carrier: assignedCarrier } = await createCarrier(
      db,
      { userId: admin.id },
      minimalCarrierInput({ dotNumber: newDot() }),
    )
    const { carrier: otherCarrier } = await createCarrier(
      db,
      { userId: admin.id },
      minimalCarrierInput({ dotNumber: newDot(), legalName: 'Other Carrier LLC' }),
    )

    await db.insert(carrierDispatcherAssignments, {
      carrierId: assignedCarrier.id,
      dispatcherUserId: dispatcherUser.id,
      isPrimary: true,
      assignedByUserId: admin.id,
    })

    const dispatcher = dispatcherActor(tenant.id, dispatcherUser.id, [assignedCarrier.id])

    const decisionForAssigned = can(dispatcher, 'carrier:read', {
      tenantId: tenant.id,
      carrierId: assignedCarrier.id,
    })
    const decisionForOther = can(dispatcher, 'carrier:read', { tenantId: tenant.id, carrierId: otherCarrier.id })
    expect(decisionForAssigned.allowed).toBe(true)
    expect(decisionForOther.allowed).toBe(false)
    expect(decisionForOther.reasonKey).toBe('errors.outOfScope')

    // The list query itself must not even return the carrier outside scope —
    // scoping happens at the query, not just at the single-record check.
    const scope = scopeFilter(dispatcher, 'assigned')
    const { carriers: visible } = await listCarriers(db, scope)
    const visibleIds = visible.map((c) => c.id)
    expect(visibleIds).toContain(assignedCarrier.id)
    expect(visibleIds).not.toContain(otherCarrier.id)
  })

  it('sees nothing when it has no assignments at all', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dispatcherUser = await createTestUser({ firstName: 'Dee', lastName: 'Dispatcher' })
    const db = tenantDb(tenant.id)

    await createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: newDot() }))

    const dispatcher = dispatcherActor(tenant.id, dispatcherUser.id, [])
    const scope = scopeFilter(dispatcher, 'assigned')
    const { carriers: visible, total } = await listCarriers(db, scope)
    expect(visible).toHaveLength(0)
    expect(total).toBe(0)
  })
})
