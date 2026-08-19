import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { createCustomer } from '@/server/customers/service'
import { createTestCustomer, createTestTenant, createTestUser, minimalCustomerInput } from './fixtures'

describe('customer duplicate detection — fires in priority order', () => {
  it('fires on DOT before anything else', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const original = await createTestCustomer(db, { userId: admin.id }, { dotNumber: '1234567' })

    const result = await createCustomer(
      db,
      { userId: admin.id },
      minimalCustomerInput({ companyName: 'A Totally Different Name Inc', dotNumber: '1234567' }),
    )

    expect(result.status).toBe('conflict')
    if (result.status === 'conflict') {
      expect(result.matches).toEqual([
        { customerId: original.id, matchedOn: 'dot', confidence: 'exact', label: original.companyName },
      ])
    }
  })

  it('fires on phone when DOT does not match', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const original = await createTestCustomer(db, { userId: admin.id }, { phone: '2145551212' })

    const result = await createCustomer(
      db,
      { userId: admin.id },
      minimalCustomerInput({ companyName: 'Different Co', phone: '(214) 555-1212' }),
    )

    expect(result.status).toBe('conflict')
    if (result.status === 'conflict') {
      expect(result.matches[0]).toMatchObject({ customerId: original.id, matchedOn: 'phone', confidence: 'exact' })
    }
  })

  it('fires on normalized name + address only once DOT/MC/phone/email are exhausted', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const original = await createTestCustomer(db, { userId: admin.id }, {
      companyName: 'Summit Freight, LLC.',
      physicalLine1: '100 Main St',
      physicalCity: 'Dallas',
      physicalState: 'TX',
      physicalPostalCode: '75201',
    })

    const result = await createCustomer(
      db,
      { userId: admin.id },
      minimalCustomerInput({
        companyName: 'Summit Freight LLC',
        physicalLine1: '100 Main St',
        physicalCity: 'Dallas',
        physicalState: 'TX',
        physicalPostalCode: '75201',
      }),
    )

    expect(result.status).toBe('conflict')
    if (result.status === 'conflict') {
      expect(result.matches[0]).toMatchObject({ customerId: original.id, matchedOn: 'name_address', confidence: 'likely' })
    }
  })

  it('does not conflict when nothing overlaps', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    await createTestCustomer(db, { userId: admin.id }, { dotNumber: '1111111' })

    const result = await createCustomer(
      db,
      { userId: admin.id },
      minimalCustomerInput({ companyName: 'Genuinely Unrelated Company', dotNumber: '2222222' }),
    )

    expect(result.status).toBe('created')
  })

  it('refuses to proceed past a conflict without a reason, and records an override once one is given', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    await createTestCustomer(db, { userId: admin.id }, { dotNumber: '3333333' })

    await expect(
      createCustomer(
        db,
        { userId: admin.id },
        minimalCustomerInput({ companyName: 'Different Name', dotNumber: '3333333', overrideDuplicate: true }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    const overridden = await createCustomer(
      db,
      { userId: admin.id },
      minimalCustomerInput({
        companyName: 'Different Name',
        dotNumber: '3333333',
        overrideDuplicate: true,
        duplicateOverrideReason: 'Confirmed with the shipper this is a separate legal entity.',
      }),
    )

    expect(overridden.status).toBe('created')
    if (overridden.status === 'created') {
      expect(overridden.customer.duplicateOverrideByUserId).toBe(admin.id)
      expect(overridden.customer.duplicateOverrideReason).toContain('separate legal entity')
    }
  })
})
