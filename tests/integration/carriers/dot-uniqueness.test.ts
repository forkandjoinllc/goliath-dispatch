import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { createCarrier } from '@/server/carriers/service'
import { createTestTenant, createTestUser, minimalCarrierInput, newDot } from './fixtures'

describe('carrier DOT uniqueness', () => {
  it('is enforced within a tenant', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const dot = newDot()

    await createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: dot }))

    await expect(
      createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: dot, legalName: 'A Different LLC' })),
    ).rejects.toMatchObject({ code: 'conflict', messageKey: 'errors.duplicateDot' })
  })

  it('allows the same DOT number to exist in two different tenants', async () => {
    const tenantA = await createTestTenant('Tenant A')
    const tenantB = await createTestTenant('Tenant B')
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dbA = tenantDb(tenantA.id)
    const dbB = tenantDb(tenantB.id)
    const dot = newDot()

    const { carrier: carrierA } = await createCarrier(dbA, { userId: admin.id }, minimalCarrierInput({ dotNumber: dot }))
    const { carrier: carrierB } = await createCarrier(dbB, { userId: admin.id }, minimalCarrierInput({ dotNumber: dot }))

    expect(carrierA.dotNumber).toBe(dot)
    expect(carrierB.dotNumber).toBe(dot)
    expect(carrierA.tenantId).not.toBe(carrierB.tenantId)
  })
})
