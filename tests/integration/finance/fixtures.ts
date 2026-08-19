import { unsafeDb } from '@/db/client'
import { customers, loads, tenants, tenantSettings, users, userTenantMemberships } from '@/db/schema'
import type { TenantDb } from '@/db/tenant-db'
import type { Role } from '@/lib/permissions'
import { createCarrier, type CreateCarrierInput } from '@/server/carriers/service'

/**
 * Shared fixtures for the finance integration suite. Mirrors
 * `tests/integration/carriers/fixtures.ts` — standing up a tenant/user is
 * inherently cross-tenant setup, so this reaches for `unsafeDb` the same way.
 */

let counter = 0
function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}

export async function createTestTenant(name = 'Test Dispatch Co') {
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
  return String(1_000_000 + counter).slice(0, 7)
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
}

export async function createTestLoad(db: TenantDb, input: CreateTestLoadInput) {
  return db.insert(loads, {
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
  })
}
