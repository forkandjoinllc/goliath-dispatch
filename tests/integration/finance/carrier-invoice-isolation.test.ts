import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { can } from '@/lib/permissions'
import type { Actor } from '@/lib/permissions'
import { createDraftInvoiceForLoad } from '@/server/invoices/service'
import { listInvoices } from '@/server/invoices/queries'
import { scopeFilter } from '@/lib/permissions/check'
import { createTestCarrier, createTestCustomer, createTestLoad, createTestTenant, createTestUser } from './fixtures'

function carrierActor(tenantId: string, carrierId: string): Actor {
  return {
    userId: 'carrier-user',
    email: 'carrier@example.test',
    firstName: 'Carrier',
    lastName: 'User',
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

describe('carrier invoice isolation', () => {
  it('a carrier cannot be authorized to read another carrier\'s invoice', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const carrierA = await createTestCarrier(db, admin.id)
    const carrierB = await createTestCarrier(db, admin.id)
    const customer = await createTestCustomer(db)

    const loadForA = await createTestLoad(db, {
      carrierId: carrierA.id,
      customerId: customer.id,
      carrierGrossRateCents: 100_000,
      status: 'pod_received',
    })
    const invoiceForA = await createDraftInvoiceForLoad(db, loadForA.id)

    const actorB = carrierActor(tenant.id, carrierB.id)

    // carrier:read is granted at 'carrier' scope, but carrier B's own carrierId
    // does not match invoice A's carrierId — the resource check must fail.
    const decision = can(actorB, 'invoice:read', { tenantId: tenant.id, carrierId: invoiceForA.carrierId })
    expect(decision.allowed).toBe(false)

    // And carrier B's own carrier IS authorized to read its own (nonexistent
    // yet) invoices — proving the denial above is about the specific
    // resource, not a blanket lack of the permission.
    const ownDecision = can(actorB, 'invoice:read', { tenantId: tenant.id, carrierId: carrierB.id })
    expect(ownDecision.allowed).toBe(true)
  })

  it('a carrier-scoped list query never returns another carrier\'s invoices', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const carrierA = await createTestCarrier(db, admin.id)
    const carrierB = await createTestCarrier(db, admin.id)
    const customer = await createTestCustomer(db)

    const loadForA = await createTestLoad(db, {
      carrierId: carrierA.id,
      customerId: customer.id,
      carrierGrossRateCents: 100_000,
      status: 'pod_received',
    })
    const loadForB = await createTestLoad(db, {
      carrierId: carrierB.id,
      customerId: customer.id,
      carrierGrossRateCents: 200_000,
      status: 'pod_received',
    })
    const invoiceForA = await createDraftInvoiceForLoad(db, loadForA.id)
    await createDraftInvoiceForLoad(db, loadForB.id)

    const actorA = carrierActor(tenant.id, carrierA.id)
    const scope = scopeFilter(actorA, 'carrier')

    const result = await listInvoices(db, scope)
    expect(result.invoices.map((i) => i.id)).toEqual([invoiceForA.id])
  })
})
