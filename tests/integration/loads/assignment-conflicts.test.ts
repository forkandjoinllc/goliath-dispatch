import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { drivers, loadAssignments, trucks } from '@/db/schema'
import { normalizeVin } from '@/lib/utils'
import { assignResources } from '@/server/loads/service'
import {
  createTestCarrier,
  createTestCustomer,
  createTestLoad,
  createTestTenant,
  createTestUser,
  uniqueVin,
} from './fixtures'

describe('assignResources — scheduling conflicts', () => {
  it('refuses a driver already committed to an overlapping load, and names the conflicting load', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = { userId: admin.id, role: 'admin' as const }

    const customer = await createTestCustomer(db, { userId: admin.id })
    const carrier = await createTestCarrier(db, admin.id)

    const { load: loadA } = await createTestLoad(db, actor, { customerId: customer.id, carrierId: carrier.id })
    const { load: loadB } = await createTestLoad(db, actor, { customerId: customer.id, carrierId: carrier.id })

    const driver = await db.insert(drivers, { firstName: 'Dana', lastName: 'Driver' })

    // loadA and loadB share the same fixture stop windows, so they overlap —
    // set up an existing commitment on loadA directly (bypassing the
    // compliance-gated `assignResources` for fixture setup) and then try to
    // assign the same driver to loadB.
    await db.insert(loadAssignments, {
      loadId: loadA.id,
      resourceType: 'driver',
      driverId: driver.id,
      committedFrom: loadA.plannedPickupAt,
      committedTo: loadA.plannedDeliveryAt,
      assignedByUserId: admin.id,
    })

    const result = await assignResources(db, actor, { loadId: loadB.id, driverIds: [driver.id] })

    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') {
      expect(result.blocked).toHaveLength(1)
      expect(result.blocked[0]!.resourceId).toBe(driver.id)
      const conflict = result.blocked[0]!.reasons.find((r) => r.code === 'scheduling_conflict')
      expect(conflict).toBeTruthy()
      expect(conflict!.params?.loadNumber).toBe(loadA.loadNumber)
    }
  })
})

describe('assignResources — non-compliant equipment', () => {
  it('refuses a freshly created, unverified truck and lists every blocking reason', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = { userId: admin.id, role: 'admin' as const }

    const customer = await createTestCustomer(db, { userId: admin.id })
    const carrier = await createTestCarrier(db, admin.id)
    const { load } = await createTestLoad(db, actor, { customerId: customer.id, carrierId: carrier.id })

    const vin = uniqueVin()
    const truck = await db.insert(trucks, {
      carrierId: carrier.id,
      unitNumber: 'T-100',
      vin,
      vinNormalized: normalizeVin(vin),
      status: 'pending_verification',
    })

    const result = await assignResources(db, actor, { loadId: load.id, truckIds: [truck.id] })

    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') {
      expect(result.blocked).toHaveLength(1)
      const codes = result.blocked[0]!.reasons.map((r) => r.code)
      // Every reason is returned, not just the first: an inactive truck with
      // no COI and no media fails all three of these independently.
      expect(codes).toEqual(
        expect.arrayContaining(['equipment_inactive', 'no_approved_coi', 'insufficient_media']),
      )
      expect(codes.length).toBeGreaterThanOrEqual(3)
    }
  })
})
