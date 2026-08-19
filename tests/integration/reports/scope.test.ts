import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import type { Actor } from '@/lib/permissions'
import { runReportForActor } from '@/server/reports/runner'
import {
  createTestCarrier,
  createTestCustomer,
  createTestLoadWithSnapshot,
  createTestTenant,
  createTestUser,
} from './fixtures'

function dispatcherActor(tenantId: string, userId: string, assignedCarrierIds: string[]): Actor & { tenantId: string } {
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

function carrierActor(tenantId: string, carrierId: string): Actor & { tenantId: string } {
  return {
    userId: 'carrier-user',
    email: 'carrier@example.test',
    firstName: 'Carol',
    lastName: 'Carrier',
    locale: 'en',
    timezone: 'America/New_York',
    isPlatformSuperAdmin: false,
    tenantId,
    role: 'carrier',
    carrierId,
    driverId: null,
    assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: null,
  }
}

describe('revenue & margin report scope', () => {
  it("a dispatcher's revenue report excludes unassigned carriers", async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dispatcherUser = await createTestUser({ firstName: 'Dee', lastName: 'Dispatcher' })
    const db = tenantDb(tenant.id)

    const assignedCarrier = await createTestCarrier(db, admin.id, { legalName: 'Assigned Carrier LLC' })
    const otherCarrier = await createTestCarrier(db, admin.id, { legalName: 'Other Carrier LLC' })
    const customer = await createTestCustomer(db)

    await createTestLoadWithSnapshot(db, {
      carrierId: assignedCarrier.id,
      customerId: customer.id,
      customerChargeCents: 500_000,
      carrierGrossRateCents: 400_000,
    })
    await createTestLoadWithSnapshot(db, {
      carrierId: otherCarrier.id,
      customerId: customer.id,
      customerChargeCents: 600_000,
      carrierGrossRateCents: 480_000,
    })

    const dispatcher = dispatcherActor(tenant.id, dispatcherUser.id, [assignedCarrier.id])

    const result = await runReportForActor({
      reportKey: 'revenue_margin',
      actor: dispatcher,
      policy: null,
      db,
      rawFilters: { range: { preset: 'monthly' }, groupBy: 'carrier' },
      locale: 'en',
    })

    const dimensions = result.rows.map((r) => r.dimension)
    expect(dimensions).toContain('Assigned Carrier LLC')
    expect(dimensions).not.toContain('Other Carrier LLC')
  })

  it("a carrier's revenue report never includes tenant margin or customer-charge columns", async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const carrier = await createTestCarrier(db, admin.id)
    const customer = await createTestCustomer(db)

    await createTestLoadWithSnapshot(db, {
      carrierId: carrier.id,
      customerId: customer.id,
      customerChargeCents: 500_000,
      carrierGrossRateCents: 400_000,
    })

    const actor = carrierActor(tenant.id, carrier.id)

    const result = await runReportForActor({
      reportKey: 'revenue_margin',
      actor,
      policy: null,
      db,
      rawFilters: { range: { preset: 'monthly' }, groupBy: 'carrier' },
      locale: 'en',
    })

    expect(result.rows.length).toBeGreaterThan(0)
    const keySet = new Set(Object.keys(result.rows[0]!))
    expect(keySet.has('customerChargeCents')).toBe(false)
    expect(keySet.has('grossMarginCents')).toBe(false)
    expect(keySet.has('marginPercent')).toBe(false)
    expect(keySet.has('dispatcherCommissionAmountCents')).toBe(false)
    expect(keySet.has('carrierGrossRateCents')).toBe(true)

    // The column metadata returned alongside the rows must match — no
    // margin column is even described, let alone populated.
    const columnKeys = new Set(result.columns.map((c) => c.key))
    expect(columnKeys.has('grossMarginCents')).toBe(false)
  })

  it("a carrier cannot see another carrier's revenue rows", async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const carrierA = await createTestCarrier(db, admin.id, { legalName: 'Carrier A LLC' })
    const carrierB = await createTestCarrier(db, admin.id, { legalName: 'Carrier B LLC' })
    const customer = await createTestCustomer(db)

    await createTestLoadWithSnapshot(db, { carrierId: carrierA.id, customerId: customer.id, carrierGrossRateCents: 100_000 })
    await createTestLoadWithSnapshot(db, { carrierId: carrierB.id, customerId: customer.id, carrierGrossRateCents: 200_000 })

    const actorA = carrierActor(tenant.id, carrierA.id)
    const result = await runReportForActor({
      reportKey: 'revenue_margin',
      actor: actorA,
      policy: null,
      db,
      rawFilters: { range: { preset: 'monthly' }, groupBy: 'carrier' },
      locale: 'en',
    })

    const dimensions = result.rows.map((r) => r.dimension)
    expect(dimensions).toEqual(['Carrier A LLC'])
  })
})
