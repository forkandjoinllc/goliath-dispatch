import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { loads } from '@/db/schema'
import { assignCarrier, updateLoad } from '@/server/loads/service'
import { createTestCarrier, createTestCustomer, createTestLoad, createTestTenant, createTestUser } from './fixtures'

describe('carrier immutability once locked', () => {
  it('refuses to reassign the carrier once carrierLockedAt is set', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = { userId: admin.id, role: 'admin' as const }

    const customer = await createTestCustomer(db, { userId: admin.id })
    const carrierA = await createTestCarrier(db, admin.id)
    const carrierB = await createTestCarrier(db, admin.id)

    const { load } = await createTestLoad(db, actor, { customerId: customer.id, carrierId: carrierA.id })

    // Simulate a completed, compliant assignment without needing the full
    // FMCSA/document setup `evaluateCarrier` would otherwise require —
    // this test is about the immutability guard, not the compliance gate.
    await db.update(loads, load.id, { carrierLockedAt: new Date() })

    await expect(assignCarrier(db, actor, { loadId: load.id, carrierId: carrierB.id })).rejects.toMatchObject({
      code: 'immutable',
      messageKey: 'errors.carrierLocked',
    })
  })

  it('updateLoad has no way to change the carrier at all', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = { userId: admin.id, role: 'admin' as const }

    const customer = await createTestCustomer(db, { userId: admin.id })
    const carrierA = await createTestCarrier(db, admin.id)
    const { load } = await createTestLoad(db, actor, { customerId: customer.id, carrierId: carrierA.id })

    const updated = await updateLoad(db, { userId: admin.id }, load.id, { internalNotes: 'unrelated edit' })
    expect(updated.carrierId).toBe(carrierA.id)
    expect(updated.internalNotes).toBe('unrelated edit')
  })
})
