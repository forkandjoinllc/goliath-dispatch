import { unsafeDb } from '@/db/client'
import { customers, loads, tenants, tenantSettings, users, userTenantMemberships } from '@/db/schema'
import type { TenantDb } from '@/db/tenant-db'
import type { Role } from '@/lib/permissions'
import { createCarrier, type CreateCarrierInput } from '@/server/carriers/service'
import { onFinancialInputChanged } from '@/server/finance/snapshots'

/**
 * Fixtures for the reporting/export/retention integration suites. Mirrors
 * `tests/integration/finance/fixtures.ts` — each suite creates its own
 * tenant to avoid cross-test interference, since integration tests share one
 * Postgres instance and run serially.
 */

let counter = 0
function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}

export async function createTestTenant(name = 'Reports Test Dispatch Co') {
  const [tenant] = await unsafeDb
    .insert(tenants)
    .values({ slug: unique('tenant').toLowerCase(), legalName: name, displayName: name, status: 'active' })
    .returning()
  await unsafeDb.insert(tenantSettings).values({ tenantId: tenant!.id })
  return tenant!
}

export async function createTestUser(input: { firstName: string; lastName: string; email?: string }) {
  const email = input.email ?? `${unique('user')}@example.test`
  const [user] = await unsafeDb
    .insert(users)
    .values({
      email,
      emailNormalized: email.toLowerCase(),
      firstName: input.firstName,
      lastName: input.lastName,
      status: 'active',
    })
    .returning()
  return user!
}

export async function createTestMembership(
  tenantId: string,
  userId: string,
  role: Role,
  extra: { carrierId?: string } = {},
) {
  const [membership] = await unsafeDb
    .insert(userTenantMemberships)
    .values({ tenantId, userId, role, status: 'active', carrierId: extra.carrierId ?? null })
    .returning()
  return membership!
}

export function newDot(): string {
  counter += 1
  return String(2_000_000 + counter).slice(0, 7)
}

export function minimalCarrierInput(overrides: Partial<CreateCarrierInput> = {}): CreateCarrierInput {
  return {
    legalName: 'Summit Heavy Haul LLC',
    dotNumber: newDot(),
    ein: '123456789',
    contactFirstName: 'Jordan',
    contactLastName: 'Rivera',
    email: `carrier-${unique('c')}@example.test`,
    phone: '2145550100',
    preferredLocale: 'en',
    mailingSameAsPhysical: true,
    usesFactoring: false,
    ...overrides,
  }
}

export async function createTestCarrier(db: TenantDb, adminUserId: string, overrides: Partial<CreateCarrierInput> = {}) {
  const { carrier } = await createCarrier(db, { userId: adminUserId }, minimalCarrierInput(overrides))
  return carrier
}

export async function createTestCustomer(
  db: TenantDb,
  overrides: Omit<Partial<typeof customers.$inferInsert>, 'tenantId'> = {},
) {
  const name = overrides.companyName ?? `Acme Freight ${unique('cust')}`
  return db.insert(customers, {
    companyName: name,
    companyNameNormalized: name.toLowerCase(),
    status: 'active',
    ...overrides,
  })
}

export interface CreateTestLoadInput {
  carrierId?: string | null
  customerId: string
  dispatcherUserId?: string | null
  customerChargeCents?: number
  carrierGrossRateCents?: number
  carrierDispatchFeeBps?: number
  dispatcherCommissionBps?: number
  dispatcherCommissionBasis?: 'dispatch_fee_amount' | 'carrier_gross_rate' | 'commissionable_base'
  status?: (typeof loads.status.enumValues)[number]
  plannedPickupAt?: Date
  actualPickupAt?: Date | null
  actualDeliveryAt?: Date | null
  plannedDeliveryAt?: Date | null
  isOversize?: boolean
}

/** Creates a load AND its financial snapshot (never recomputed at report read time). */
export async function createTestLoadWithSnapshot(db: TenantDb, input: CreateTestLoadInput) {
  const load = await db.insert(loads, {
    loadNumber: unique('LOAD'),
    customerId: input.customerId,
    carrierId: input.carrierId ?? null,
    dispatcherUserId: input.dispatcherUserId ?? null,
    status: input.status ?? 'assigned',
    customerChargeCents: input.customerChargeCents ?? 0,
    carrierGrossRateCents: input.carrierGrossRateCents ?? 0,
    carrierDispatchFeeBps: input.carrierDispatchFeeBps ?? 1000,
    dispatcherCommissionBps: input.dispatcherCommissionBps ?? 2500,
    dispatcherCommissionBasis: input.dispatcherCommissionBasis ?? 'dispatch_fee_amount',
    plannedPickupAt: input.plannedPickupAt ?? new Date(),
    actualPickupAt: input.actualPickupAt ?? null,
    plannedDeliveryAt: input.plannedDeliveryAt ?? null,
    actualDeliveryAt: input.actualDeliveryAt ?? null,
    isOversize: input.isOversize ?? false,
  })

  const { snapshot } = await onFinancialInputChanged(db, load.id, { reason: 'test_fixture', actorUserId: null })
  return { load, snapshot }
}
