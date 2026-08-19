import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { createLoad } from '@/server/loads/service'
import { createTestCustomer, createTestTenant, createTestUser, minimalLoadInput } from './fixtures'

describe('load numbering — concurrency', () => {
  it('allocates distinct load numbers under concurrent createLoad calls', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const customer = await createTestCustomer(db, { userId: admin.id })
    const actor = { userId: admin.id, role: 'admin' as const }

    const CONCURRENCY = 8
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => createLoad(db, actor, minimalLoadInput({ customerId: customer.id }))),
    )

    const numbers = results.map((r) => r.load.loadNumber)
    expect(new Set(numbers).size).toBe(CONCURRENCY)
  })
})
