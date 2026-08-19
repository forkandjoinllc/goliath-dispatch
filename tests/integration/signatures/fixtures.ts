import { unsafeDb } from '@/db/client'
import { tenants, tenantSettings, users, userTenantMemberships } from '@/db/schema'
import type { Role } from '@/lib/permissions'
import type { CreateTemplateInput } from '@/server/signatures/templates'

/**
 * Shared fixtures for the signatures integration suite. Reaches for
 * `unsafeDb` directly — tests are exempt from the `no-restricted-imports`
 * rule — because standing up a tenant/user is inherently cross-tenant setup.
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

/** A minimal, valid template-content input — override only what a test cares about. */
export function minimalTemplateFields(overrides: Partial<CreateTemplateInput> = {}): CreateTemplateInput {
  return {
    templateKey: unique('template'),
    titleEn: 'Notice of Assignment',
    titleEs: 'Aviso de Cesión',
    bodyEn: 'Effective {{effectiveDate}}, {{carrierLegalName}} assigns payment under this arrangement.',
    bodyEs: 'A partir del {{effectiveDate}}, {{carrierLegalName}} cede el pago bajo este acuerdo.',
    consentCopyEn: 'By signing electronically below you agree to conduct this transaction electronically.',
    consentCopyEs: 'Al firmar electrónicamente a continuación, usted acepta realizar esta transacción electrónicamente.',
    requiredTokens: ['effectiveDate', 'carrierLegalName'],
    ...overrides,
  }
}

export const DEFAULT_TOKEN_VALUES = { effectiveDate: '2026-01-01', carrierLegalName: 'Summit Heavy Haul LLC' }

/** A syntactically valid, minimal 1x1 transparent PNG, base64-encoded. */
export const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export function pngDataUrl(base64 = ONE_PIXEL_PNG_BASE64): string {
  return `data:image/png;base64,${base64}`
}
