import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { financialSnapshots, loadAssignments, loadStatusHistory, loadStops } from '@/db/schema'
import { drivers } from '@/db/schema'
import { duplicateLoad, transitionStatus } from '@/server/loads/service'
import { createTestCarrier, createTestCustomer, createTestLoad, createTestTenant, createTestUser } from './fixtures'

describe('duplicateLoad', () => {
  it('copies customer, stops, dimensions, equipment requirement and financial percentages, and omits everything else', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = { userId: admin.id, role: 'admin' as const }

    const customer = await createTestCustomer(db, { userId: admin.id })
    const carrier = await createTestCarrier(db, admin.id)

    const { load: source } = await createTestLoad(db, actor, {
      customerId: customer.id,
      carrierId: carrier.id,
      commodity: 'Steel coils',
      weightPounds: 42_000,
      lengthInches: 600,
      widthInches: 100,
      heightInches: 140,
      carrierDispatchFeeBps: 1200,
      dispatcherCommissionBps: 3000,
      customerChargeCents: 500_000,
      carrierGrossRateCents: 400_000,
    })

    const driver = await db.insert(drivers, { firstName: 'Dana', lastName: 'Driver' })
    await db.insert(loadAssignments, {
      loadId: source.id,
      resourceType: 'driver',
      driverId: driver.id,
      assignedByUserId: admin.id,
    })
    await transitionStatus(db, actor, { ipAddress: null, userAgent: null }, { loadId: source.id, to: 'cancelled' })
    // (cancelling also releases the assignment and writes status history —
    // exactly the kind of load-specific state duplication must not copy.)

    const result = await duplicateLoad(db, actor, source.id)

    expect(result.load.customerId).toBe(customer.id)
    expect(result.load.commodity).toBe('Steel coils')
    expect(result.load.weightPounds).toBe(42_000)
    expect(result.load.lengthInches).toBe(600)
    expect(result.load.widthInches).toBe(100)
    expect(result.load.heightInches).toBe(140)
    expect(result.load.carrierDispatchFeeBps).toBe(1200)
    expect(result.load.dispatcherCommissionBps).toBe(3000)
    expect(result.load.duplicatedFromLoadId).toBe(source.id)
    expect(result.stops).toHaveLength(2)

    // Not copied: carrier, assignments, status, financial dollar amounts.
    expect(result.load.carrierId).toBeNull()
    expect(result.load.carrierLockedAt).toBeNull()
    expect(result.load.status).toBe('draft')
    expect(result.load.customerChargeCents).toBe(0)
    expect(result.load.carrierGrossRateCents).toBe(0)

    const newAssignments = await db.findMany(loadAssignments, { where: eq(loadAssignments.loadId, result.load.id) })
    expect(newAssignments).toHaveLength(0)

    const newHistory = await db.findMany(loadStatusHistory, { where: eq(loadStatusHistory.loadId, result.load.id) })
    expect(newHistory).toHaveLength(0)

    const newSnapshots = await db.findMany(financialSnapshots, { where: eq(financialSnapshots.loadId, result.load.id) })
    expect(newSnapshots).toHaveLength(1)
    expect(newSnapshots[0]!.version).toBe(1)

    const sourceStopsCount = await db.findMany(loadStops, { where: eq(loadStops.loadId, source.id) })
    expect(sourceStopsCount).toHaveLength(2) // source stops untouched
  })
})
