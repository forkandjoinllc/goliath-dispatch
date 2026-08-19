import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { customerContacts } from '@/db/schema'
import { createContact, setPrimaryContact, updateContact } from '@/server/customers/service'
import { createTestCustomer, createTestTenant, createTestUser } from './fixtures'

async function primaryContacts(db: ReturnType<typeof tenantDb>, customerId: string) {
  return db.findMany(customerContacts, {
    where: and(eq(customerContacts.customerId, customerId), eq(customerContacts.isPrimary, true))!,
  })
}

describe('exactly one primary contact per customer', () => {
  it('promoting a new primary contact demotes the previous one, atomically', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const customer = await createTestCustomer(db, { userId: admin.id })

    const first = await createContact(db, { userId: admin.id }, {
      customerId: customer.id,
      firstName: 'Pat',
      lastName: 'Primary',
      isPrimary: true,
    })
    expect(first.isPrimary).toBe(true)
    expect(await primaryContacts(db, customer.id)).toHaveLength(1)

    const second = await createContact(db, { userId: admin.id }, {
      customerId: customer.id,
      firstName: 'Sam',
      lastName: 'Secondary',
      isPrimary: true,
    })

    const primaries = await primaryContacts(db, customer.id)
    expect(primaries).toHaveLength(1)
    expect(primaries[0]!.id).toBe(second.id)
  })

  it('setPrimaryContact swaps primacy to an existing non-primary contact', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const customer = await createTestCustomer(db, { userId: admin.id })

    const first = await createContact(db, { userId: admin.id }, {
      customerId: customer.id,
      firstName: 'Pat',
      lastName: 'Primary',
      isPrimary: true,
    })
    const second = await createContact(db, { userId: admin.id }, {
      customerId: customer.id,
      firstName: 'Sam',
      lastName: 'Secondary',
    })
    expect(second.isPrimary).toBe(false)

    await setPrimaryContact(db, { userId: admin.id }, customer.id, second.id)

    const primaries = await primaryContacts(db, customer.id)
    expect(primaries).toHaveLength(1)
    expect(primaries[0]!.id).toBe(second.id)

    const reloadedFirst = await db.findById(customerContacts, first.id)
    expect(reloadedFirst!.isPrimary).toBe(false)
  })

  it('updateContact promoting isPrimary:true also demotes the current primary', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const customer = await createTestCustomer(db, { userId: admin.id })

    const first = await createContact(db, { userId: admin.id }, {
      customerId: customer.id,
      firstName: 'Pat',
      lastName: 'Primary',
      isPrimary: true,
    })
    const second = await createContact(db, { userId: admin.id }, {
      customerId: customer.id,
      firstName: 'Sam',
      lastName: 'Secondary',
    })

    await updateContact(db, { userId: admin.id }, { contactId: second.id, isPrimary: true })

    const primaries = await primaryContacts(db, customer.id)
    expect(primaries).toHaveLength(1)
    expect(primaries[0]!.id).toBe(second.id)

    const reloadedFirst = await db.findById(customerContacts, first.id)
    expect(reloadedFirst!.isPrimary).toBe(false)
  })
})
