import { unsafeDb } from '@/db/client'
import { tenants, tenantSettings, users, userTenantMemberships } from '@/db/schema'
import { hashPassword } from '@/lib/auth/password'
import type { Role } from '@/lib/permissions'
import type { LoginAttemptContext } from '@/server/auth/login'

/**
 * Shared fixtures for the auth integration suite. Reaches for `unsafeDb`
 * directly — tests are exempt from the `no-restricted-imports` rule — because
 * standing up a tenant/user/membership is inherently cross-tenant setup.
 */

let counter = 0
function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}

export async function createTestTenant(
  overrides: Partial<{ name: string; status: (typeof tenants.$inferInsert)['status'] }> = {},
) {
  const name = overrides.name ?? 'Test Dispatch Co'
  const [tenant] = await unsafeDb
    .insert(tenants)
    .values({
      slug: unique('tenant').toLowerCase(),
      legalName: name,
      displayName: name,
      status: overrides.status ?? 'active',
    })
    .returning()
  await unsafeDb.insert(tenantSettings).values({ tenantId: tenant!.id })
  return tenant!
}

export const DEFAULT_TEST_PASSWORD = 'CorrectHorseBattery9'

export async function createTestUser(
  overrides: Partial<{
    firstName: string
    lastName: string
    email: string
    password: string
    status: (typeof users.$inferInsert)['status']
    emailVerifiedAt: Date | null
    isPlatformSuperAdmin: boolean
  }> = {},
) {
  const email = overrides.email ?? `${unique('user')}@example.test`
  const password = overrides.password ?? DEFAULT_TEST_PASSWORD
  const passwordHash = await hashPassword(password)
  const [user] = await unsafeDb
    .insert(users)
    .values({
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash,
      firstName: overrides.firstName ?? 'Ada',
      lastName: overrides.lastName ?? 'Admin',
      status: overrides.status ?? 'active',
      emailVerifiedAt: overrides.emailVerifiedAt === undefined ? new Date() : overrides.emailVerifiedAt,
      isPlatformSuperAdmin: overrides.isPlatformSuperAdmin ?? false,
    })
    .returning()
  return { user: user!, password }
}

export async function createTestMembership(tenantId: string, userId: string, role: Role) {
  const [membership] = await unsafeDb
    .insert(userTenantMemberships)
    .values({ tenantId, userId, role, status: 'active', acceptedAt: new Date() })
    .returning()
  return membership!
}

export function testLoginContext(overrides: Partial<LoginAttemptContext> = {}): LoginAttemptContext {
  return {
    ipAddress: overrides.ipAddress ?? '203.0.113.10',
    userAgent: overrides.userAgent ?? 'vitest-integration',
  }
}
