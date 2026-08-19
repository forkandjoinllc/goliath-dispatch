import { unsafeDb } from '@/db/client'
import { tenants, tenantSettings, users, userTenantMemberships } from '@/db/schema'
import type { TenantDb } from '@/db/tenant-db'
import { documentVersions, documents } from '@/db/schema'
import type { Role } from '@/lib/permissions'
import { createCarrier } from '@/server/carriers/service'
import { minimalCarrierInput, newDot } from '../carriers/fixtures'

/**
 * Shared fixtures for the equipment + driver integration suites. Mirrors
 * `tests/integration/carriers/fixtures.ts` — this suite reaches for
 * `unsafeDb` for the same reason that one does (standing up a tenant/user is
 * inherently cross-tenant setup).
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
    .values({ email, emailNormalized: email.toLowerCase(), firstName: input.firstName, lastName: input.lastName, status: 'active' })
    .returning()
  return user!
}

export async function createTestMembership(
  tenantId: string,
  userId: string,
  role: Role,
  extra: { carrierId?: string; driverId?: string } = {},
) {
  const [membership] = await unsafeDb
    .insert(userTenantMemberships)
    .values({ tenantId, userId, role, status: 'active', carrierId: extra.carrierId ?? null, driverId: extra.driverId ?? null })
    .returning()
  return membership!
}

export async function createTestCarrier(db: TenantDb, adminUserId: string) {
  const { carrier } = await createCarrier(
    db,
    { userId: adminUserId },
    minimalCarrierInput({ dotNumber: newDot() }),
  )
  return carrier
}

export { newDot }

/** A VIN with a valid check digit — the same worked example used in `tests/unit/equipment/vin.test.ts`. */
export function goodVin(): string {
  return '1M8GDM9AXKP042788'
}

const VIN_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'

/** A structurally valid, unique-per-call VIN (varies the last character only — fine for uniqueness tests, which don't depend on the check digit). */
export function uniqueVin(): string {
  counter += 1
  const base = goodVin()
  const char = VIN_ALPHABET[counter % VIN_ALPHABET.length]
  return `${base.slice(0, 16)}${char}`
}

/**
 * Approves a certificate of insurance for the carrier with the given VIN(s)
 * already "extracted" (as if OCR had already run), so
 * `verifyEquipmentAgainstCoi` finds an immediate match without needing a real
 * storage read.
 */
export async function approveCoiWithVins(db: TenantDb, carrierId: string, vins: string[]) {
  const document = await db.insert(documents, {
    documentType: 'certificate_of_insurance',
    ownerType: 'carrier',
    ownerId: carrierId,
    reviewStatus: 'approved',
    isRequired: true,
  })

  const version = await db.insert(documentVersions, {
    documentId: document.id,
    versionNumber: 1,
    storageKey: `tenants/${db.tenantId}/carriers/${carrierId}/documents/${document.id}/v1/coi.pdf`,
    originalFilename: 'coi.pdf',
    contentType: 'application/pdf',
    byteSize: 1024,
    sha256: 'a'.repeat(64),
    malwareScanStatus: 'clean',
    extraction: { vins },
    extractionStatus: 'completed',
  })

  return db.update(documents, document.id, { currentVersionId: version.id })
}
