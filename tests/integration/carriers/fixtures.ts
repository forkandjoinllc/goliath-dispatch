import { unsafeDb } from '@/db/client'
import { tenants, tenantSettings, users, userTenantMemberships } from '@/db/schema'
import type { Role } from '@/lib/permissions'
import type { CreateCarrierInput } from '@/server/carriers/service'

/**
 * Shared fixtures for the carrier integration suite.
 *
 * These reach for `unsafeDb` directly — tests are exempt from the
 * `no-restricted-imports` rule that blocks it in feature code — because
 * standing up a tenant/user/membership is inherently cross-tenant setup, not
 * something any single `TenantDb` handle could do.
 */

let counter = 0
function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}

export async function createTestTenant(name = 'Test Dispatch Co') {
  const [tenant] = await unsafeDb
    .insert(tenants)
    .values({
      slug: unique('tenant').toLowerCase(),
      legalName: name,
      displayName: name,
      status: 'active',
    })
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

export async function createTestMembership(tenantId: string, userId: string, role: Role) {
  const [membership] = await unsafeDb
    .insert(userTenantMemberships)
    .values({ tenantId, userId, role, status: 'active' })
    .returning()
  return membership!
}

/** A minimal, valid `createCarrier` input — override only what a test cares about. */
export function minimalCarrierInput(overrides: Partial<CreateCarrierInput> = {}): CreateCarrierInput {
  return {
    legalName: 'Summit Heavy Haul LLC',
    dotNumber: unique('dot').replace(/\D/g, '').slice(0, 7).padStart(7, '1'),
    ein: '123456789',
    contactFirstName: 'Jordan',
    contactLastName: 'Rivera',
    email: 'ops@summitheavyhaul.test',
    phone: '2145550100',
    preferredLocale: 'en',
    mailingSameAsPhysical: true,
    usesFactoring: false,
    ...overrides,
  }
}

export function newDot(): string {
  counter += 1
  return String(1_000_000 + counter).slice(0, 7)
}
