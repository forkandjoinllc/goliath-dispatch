import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { createDriver, updateDriver } from '@/server/drivers/service'
import { createTestTenant, createTestUser } from './fixtures'

describe('driver licence blind index', () => {
  it('detects a duplicate licence number within a tenant', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    await createDriver(db, { userId: admin.id }, {
      firstName: 'Hank',
      lastName: 'Hauler',
      preferredLocale: 'en',
      licenseState: 'TX',
      licenseNumber: 'TX-88221199',
    })

    await expect(
      createDriver(db, { userId: admin.id }, {
        firstName: 'Frank',
        lastName: 'Freight',
        preferredLocale: 'en',
        licenseState: 'TX',
        licenseNumber: 'TX-88221199',
      }),
    ).rejects.toMatchObject({ code: 'conflict', messageKey: 'driver.errors.duplicateLicense' })
  })

  it('does not flag the same licence number as a duplicate across two different tenants', async () => {
    const tenantA = await createTestTenant('Tenant A')
    const tenantB = await createTestTenant('Tenant B')
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dbA = tenantDb(tenantA.id)
    const dbB = tenantDb(tenantB.id)

    const driverA = await createDriver(dbA, { userId: admin.id }, {
      firstName: 'Hank',
      lastName: 'Hauler',
      preferredLocale: 'en',
      licenseState: 'TX',
      licenseNumber: 'TX-99887766',
    })
    const driverB = await createDriver(dbB, { userId: admin.id }, {
      firstName: 'Hank',
      lastName: 'Hauler',
      preferredLocale: 'en',
      licenseState: 'TX',
      licenseNumber: 'TX-99887766',
    })

    expect(driverA.licenseNumberHash).toBe(driverB.licenseNumberHash)
    expect(driverA.tenantId).not.toBe(driverB.tenantId)
  })

  it('never stores the plaintext licence number — only ciphertext, last4 and a blind-index hash', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const driver = await createDriver(db, { userId: admin.id }, {
      firstName: 'Hank',
      lastName: 'Hauler',
      preferredLocale: 'en',
      licenseState: 'TX',
      licenseNumber: 'TX-55443322',
    })

    expect(driver.licenseNumberEncrypted).not.toContain('55443322')
    expect(driver.licenseNumberLast4).toBe('3322')
    expect(driver.licenseNumberHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('leaves the stored ciphertext untouched when a masked field is not actively resupplied', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const driver = await createDriver(db, { userId: admin.id }, {
      firstName: 'Hank',
      lastName: 'Hauler',
      preferredLocale: 'en',
      licenseState: 'TX',
      licenseNumber: 'TX-11229988',
    })

    // Simulates a form submission where the licence field was left showing its
    // masked placeholder and the caller (correctly) omits the key entirely.
    const updated = await updateDriver(db, { userId: admin.id }, driver.id, {
      phone: '2145550101',
    })

    expect(updated.licenseNumberEncrypted).toBe(driver.licenseNumberEncrypted)
    expect(updated.licenseNumberHash).toBe(driver.licenseNumberHash)
    expect(updated.licenseNumberLast4).toBe(driver.licenseNumberLast4)
    expect(updated.phone).toBe('2145550101')
  })

  it('refuses a licence value that still contains the mask character, rather than sealing it', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const driver = await createDriver(db, { userId: admin.id }, {
      firstName: 'Hank',
      lastName: 'Hauler',
      preferredLocale: 'en',
      licenseState: 'TX',
      licenseNumber: 'TX-11228877',
    })

    await expect(
      updateDriver(db, { userId: admin.id }, driver.id, { licenseNumber: '••••8877' }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('does reseal when a genuinely new licence number is supplied', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const driver = await createDriver(db, { userId: admin.id }, {
      firstName: 'Hank',
      lastName: 'Hauler',
      preferredLocale: 'en',
      licenseState: 'TX',
      licenseNumber: 'TX-00112233',
    })

    const updated = await updateDriver(db, { userId: admin.id }, driver.id, { licenseNumber: 'TX-99001122' })

    expect(updated.licenseNumberLast4).toBe('1122')
    expect(updated.licenseNumberHash).not.toBe(driver.licenseNumberHash)
  })
})
