import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { createTruck } from '@/server/equipment/service'
import { createTestCarrier, createTestTenant, createTestUser, goodVin } from './fixtures'

describe('truck VIN uniqueness', () => {
  it('is enforced within a tenant', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)
    const vin = goodVin()

    await createTruck(db, { userId: admin.id }, { carrierId: carrier.id, unitNumber: '100', vin })

    await expect(
      createTruck(db, { userId: admin.id }, { carrierId: carrier.id, unitNumber: '101', vin }),
    ).rejects.toMatchObject({ code: 'conflict', messageKey: 'errors.duplicateVin' })
  })

  it('allows the same VIN to exist in two different tenants', async () => {
    const tenantA = await createTestTenant('Tenant A')
    const tenantB = await createTestTenant('Tenant B')
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dbA = tenantDb(tenantA.id)
    const dbB = tenantDb(tenantB.id)
    const carrierA = await createTestCarrier(dbA, admin.id)
    const carrierB = await createTestCarrier(dbB, admin.id)
    const vin = goodVin()

    const truckA = await createTruck(dbA, { userId: admin.id }, { carrierId: carrierA.id, unitNumber: '200', vin })
    const truckB = await createTruck(dbB, { userId: admin.id }, { carrierId: carrierB.id, unitNumber: '200', vin })

    expect(truckA.vinNormalized).toBe(truckB.vinNormalized)
    expect(truckA.tenantId).not.toBe(truckB.tenantId)
  })

  it('folds I/O/Q typos before comparing, so a mistyped duplicate is still caught', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)

    // '1M8GDM9AXKP042788' has a '0' at position 12; typing 'O' there instead folds
    // back to the same normalized VIN, so this must collide with the first insert.
    await createTruck(db, { userId: admin.id }, { carrierId: carrier.id, unitNumber: '300', vin: '1M8GDM9AXKP042788' })

    await expect(
      createTruck(db, { userId: admin.id }, { carrierId: carrier.id, unitNumber: '301', vin: '1M8GDM9AXKPO42788' }),
    ).rejects.toMatchObject({ code: 'conflict', messageKey: 'errors.duplicateVin' })
  })

  it('auto-populates year and make from the VIN when left blank', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)

    // WMI '1FU' is Freightliner.
    const truck = await createTruck(db, { userId: admin.id }, {
      carrierId: carrier.id,
      unitNumber: '400',
      vin: '1FU9GHDR3YLA00001',
    })

    expect(truck.make).toBe('Freightliner')
    expect(truck.year).not.toBeNull()
    expect(truck.vinDecodeSource).toBe('vin_decode')
    expect(truck.vinDecodedAt).not.toBeNull()
  })

  it('never overwrites a user-supplied year/make with the decoded value', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)

    const truck = await createTruck(db, { userId: admin.id }, {
      carrierId: carrier.id,
      unitNumber: '401',
      vin: '1FU9GHDR3YLA00002',
      year: 2021,
      make: 'Custom Rebuild',
    })

    expect(truck.year).toBe(2021)
    expect(truck.make).toBe('Custom Rebuild')
    expect(truck.vinDecodeSource).toBeNull()
  })
})
