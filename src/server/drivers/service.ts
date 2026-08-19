import 'server-only'
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  driverCarrierRelationships,
  drivers,
  tenants,
  userTenantMemberships,
  verificationTokens,
  type Driver,
  type DriverCarrierRelationship,
} from '@/db/schema'
import { AppError, conflict, forbidden, notFound } from '@/lib/errors'
import { sealIdentifier } from '@/lib/crypto'
import type { Actor } from '@/lib/permissions'
import { issueInvitation, sendInvitationEmail } from '@/server/auth/registration'

/**
 * The driver domain.
 *
 * As with `carriers/service.ts`, nothing here checks a permission —
 * `defineAction` already did that. This layer owns licence-number sealing
 * and blind-index uniqueness, the many-to-many carrier relationship, and the
 * manual licence-review workflow (`driver:approve`).
 *
 * The licence number is never decrypted here or anywhere in this module: the
 * blind index (`licenseNumberHash`) is what powers the uniqueness check and
 * duplicate detection, and the UI only ever renders `licenseNumberLast4`
 * through `maskLast4()`.
 */

function activeRelationshipWindow() {
  const now = new Date()
  return or(isNull(driverCarrierRelationships.endDate), gt(driverCarrierRelationships.endDate, now))!
}

/**
 * A masked field is "not supplied" only when the caller omits the key
 * entirely (`undefined`); an explicit empty string clears it. A value that
 * still contains the mask character is refused outright — the one case this
 * guards against is a client bug that echoes `••••1234` back as if it were a
 * freshly typed value, which must never reach `sealIdentifier` and overwrite
 * the real ciphertext.
 */
function assertNotMaskedValue(value: string): void {
  if (value.includes('•')) {
    throw new AppError('validation_failed', 'validation.required')
  }
}

async function assertLicenseAvailable(db: TenantDb, hash: string, excludeId?: string): Promise<void> {
  const clauses = [eq(drivers.licenseNumberHash, hash)]
  const existing = await db.findFirst(drivers, { where: and(...clauses) })
  if (existing && existing.id !== excludeId) {
    throw conflict('driver.errors.duplicateLicense', {})
  }
}

/* ── Create ──────────────────────────────────────────────────────────────── */

export interface CreateDriverInput {
  firstName: string
  lastName: string
  dateOfBirth?: string | null
  email?: string | null
  phone?: string | null
  preferredLocale: 'en' | 'es'
  licenseState?: string | null
  licenseNumber?: string | null
  cdlClass?: string | null
  endorsements?: string[]
  restrictions?: string[]
  licenseExpiresAt?: Date | null
  medicalCardExpiresAt?: Date | null
  notes?: string | null
}

export async function createDriver(db: TenantDb, _actor: { userId: string }, input: CreateDriverInput): Promise<Driver> {
  let sealed: { encrypted: string; last4: string; hash: string } | null = null
  if (input.licenseNumber) {
    assertNotMaskedValue(input.licenseNumber)
    sealed = sealIdentifier(input.licenseNumber, 'driver_license')
    await assertLicenseAvailable(db, sealed.hash)
  }

  return db.insert(drivers, {
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: input.dateOfBirth ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    preferredLocale: input.preferredLocale,
    licenseState: input.licenseState ?? null,
    licenseNumberEncrypted: sealed?.encrypted ?? null,
    licenseNumberLast4: sealed?.last4 ?? null,
    licenseNumberHash: sealed?.hash ?? null,
    cdlClass: input.cdlClass ?? null,
    endorsements: input.endorsements ?? [],
    restrictions: input.restrictions ?? [],
    licenseExpiresAt: input.licenseExpiresAt ?? null,
    medicalCardExpiresAt: input.medicalCardExpiresAt ?? null,
    status: 'available',
    verificationStatus: 'not_started',
    notes: input.notes ?? null,
  })
}

/* ── Update ──────────────────────────────────────────────────────────────── */

export type UpdateDriverInput = Partial<CreateDriverInput>

export async function updateDriver(
  db: TenantDb,
  _actor: { userId: string },
  driverId: string,
  patch: UpdateDriverInput,
): Promise<Driver> {
  await db.requireById(drivers, driverId, 'driver')

  const values: Partial<Driver> = {}
  if (patch.firstName !== undefined) values.firstName = patch.firstName
  if (patch.lastName !== undefined) values.lastName = patch.lastName
  if (patch.dateOfBirth !== undefined) values.dateOfBirth = patch.dateOfBirth
  if (patch.email !== undefined) values.email = patch.email
  if (patch.phone !== undefined) values.phone = patch.phone
  if (patch.preferredLocale !== undefined) values.preferredLocale = patch.preferredLocale
  if (patch.licenseState !== undefined) values.licenseState = patch.licenseState
  if (patch.cdlClass !== undefined) values.cdlClass = patch.cdlClass
  if (patch.endorsements !== undefined) values.endorsements = patch.endorsements
  if (patch.restrictions !== undefined) values.restrictions = patch.restrictions
  if (patch.licenseExpiresAt !== undefined) values.licenseExpiresAt = patch.licenseExpiresAt
  if (patch.medicalCardExpiresAt !== undefined) values.medicalCardExpiresAt = patch.medicalCardExpiresAt
  if (patch.notes !== undefined) values.notes = patch.notes

  // `licenseNumber` is the one masked field on this record. Only reseal when
  // the caller actively supplied a real, unmasked value — an omitted key
  // (patch.licenseNumber === undefined) must leave the stored ciphertext,
  // last4 and hash completely untouched.
  if (patch.licenseNumber !== undefined && patch.licenseNumber !== null && patch.licenseNumber !== '') {
    assertNotMaskedValue(patch.licenseNumber)
    const sealed = sealIdentifier(patch.licenseNumber, 'driver_license')
    await assertLicenseAvailable(db, sealed.hash, driverId)
    values.licenseNumberEncrypted = sealed.encrypted
    values.licenseNumberLast4 = sealed.last4
    values.licenseNumberHash = sealed.hash
  }

  const updated = await db.update(drivers, driverId, values)
  if (!updated) throw notFound('errors.notFound', { entity: 'driver' })
  return updated
}

export async function setDriverStatus(
  db: TenantDb,
  _actor: { userId: string },
  driverId: string,
  status: Driver['status'],
): Promise<Driver> {
  const updated = await db.update(drivers, driverId, { status })
  if (!updated) throw notFound('errors.notFound', { entity: 'driver' })
  return updated
}

/* ── Licence review (driver:approve) ────────────────────────────────────── */

export interface ReviewDriverLicenseInput {
  driverId: string
  status: 'verified' | 'failed'
  notes?: string | null
}

/** Manual review: records the reviewer, the timestamp and the notes — there is no automated licence OCR gate for drivers. */
export async function reviewDriverLicense(
  db: TenantDb,
  actor: Actor,
  input: ReviewDriverLicenseInput,
): Promise<Driver> {
  if (input.status === 'failed' && !input.notes?.trim()) {
    throw new AppError('validation_failed', 'validation.required')
  }

  const updated = await db.update(drivers, input.driverId, {
    verificationStatus: input.status,
    verifiedByUserId: actor.userId,
    verifiedAt: new Date(),
    verificationNotes: input.notes ?? null,
  })
  if (!updated) throw notFound('errors.notFound', { entity: 'driver' })
  return updated
}

/* ── Carrier relationships ───────────────────────────────────────────────── */

export interface AddDriverCarrierRelationshipInput {
  driverId: string
  carrierId: string
  isPrimary?: boolean
  startDate?: Date
}

/**
 * Linking a driver to a carrier is itself the approval act — the
 * `approvedByUserId`/`approvedAt` columns record whoever created the
 * relationship. There is no separate two-step review for the relationship
 * itself; licence review (`reviewDriverLicense`) is the one manual approval
 * step this domain has.
 */
export async function addDriverCarrierRelationship(
  db: TenantDb,
  actor: { userId: string },
  input: AddDriverCarrierRelationshipInput,
): Promise<DriverCarrierRelationship> {
  await db.requireById(drivers, input.driverId, 'driver')

  const alreadyActive = await db.exists(
    driverCarrierRelationships,
    and(
      eq(driverCarrierRelationships.driverId, input.driverId),
      eq(driverCarrierRelationships.carrierId, input.carrierId),
      activeRelationshipWindow(),
    )!,
  )
  if (alreadyActive) {
    throw conflict('driver.errors.relationshipAlreadyActive', {})
  }

  return db.transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.updateWhere(
        driverCarrierRelationships,
        and(eq(driverCarrierRelationships.driverId, input.driverId), eq(driverCarrierRelationships.isPrimary, true), activeRelationshipWindow())!,
        { isPrimary: false },
      )
    }

    return tx.insert(driverCarrierRelationships, {
      driverId: input.driverId,
      carrierId: input.carrierId,
      isPrimary: input.isPrimary ?? false,
      startDate: input.startDate ?? new Date(),
      approvedByUserId: actor.userId,
      approvedAt: new Date(),
    })
  })
}

export interface EndDriverCarrierRelationshipInput {
  driverId: string
  carrierId: string
}

/** Ends the active window; the row itself is retained as history, matching `carriers/service.ts::removeDispatcher`. */
export async function endDriverCarrierRelationship(
  db: TenantDb,
  _actor: { userId: string },
  input: EndDriverCarrierRelationshipInput,
): Promise<DriverCarrierRelationship[]> {
  const rows = await db.updateWhere(
    driverCarrierRelationships,
    and(
      eq(driverCarrierRelationships.driverId, input.driverId),
      eq(driverCarrierRelationships.carrierId, input.carrierId),
      isNull(driverCarrierRelationships.endDate),
    )!,
    { endDate: new Date() },
  )
  if (rows.length === 0) throw notFound('errors.notFound', { entity: 'driverCarrierRelationship' })
  return rows
}

export interface SetPrimaryCarrierInput {
  driverId: string
  carrierId: string
}

export async function setPrimaryCarrierForDriver(
  db: TenantDb,
  _actor: { userId: string },
  input: SetPrimaryCarrierInput,
): Promise<DriverCarrierRelationship> {
  return db.transaction(async (tx) => {
    await tx.updateWhere(
      driverCarrierRelationships,
      and(eq(driverCarrierRelationships.driverId, input.driverId), eq(driverCarrierRelationships.isPrimary, true), activeRelationshipWindow())!,
      { isPrimary: false },
    )

    const existing = await tx.findFirst(driverCarrierRelationships, {
      where: and(
        eq(driverCarrierRelationships.driverId, input.driverId),
        eq(driverCarrierRelationships.carrierId, input.carrierId),
        activeRelationshipWindow(),
      )!,
    })
    if (!existing) throw notFound('errors.notFound', { entity: 'driverCarrierRelationship' })

    const updated = await tx.update(driverCarrierRelationships, existing.id, { isPrimary: true })
    if (!updated) throw notFound('errors.notFound', { entity: 'driverCarrierRelationship' })
    return updated
  })
}

/* ── Portal access (login ↔ driver record) ───────────────────────────────── */

/**
 * Resolves the carrier a driver-portal invitation/link should be attributed
 * to: the acting Carrier user's own carrier if they hold an active
 * relationship with this driver (verified, never trusted from client input
 * the way `driverResource()` in `actions.ts` verifies it for every other
 * driver action), otherwise the driver's primary active relationship — the
 * path an Admin, who has no `carrierId` of their own, takes.
 */
async function resolvePortalCarrierId(db: TenantDb, actor: Actor, driverId: string): Promise<string | null> {
  if (actor.carrierId) {
    const hasRelationship = await db.exists(
      driverCarrierRelationships,
      and(
        eq(driverCarrierRelationships.driverId, driverId),
        eq(driverCarrierRelationships.carrierId, actor.carrierId),
        activeRelationshipWindow(),
      )!,
    )
    if (!hasRelationship) {
      // Defense in depth — `driverResource()` already refuses this action
      // before the handler runs when no such relationship exists.
      throw forbidden('errors.outOfScope')
    }
    return actor.carrierId
  }

  const primary = await db.findFirst(driverCarrierRelationships, {
    where: and(eq(driverCarrierRelationships.driverId, driverId), eq(driverCarrierRelationships.isPrimary, true), activeRelationshipWindow())!,
  })
  if (primary) return primary.carrierId

  const any = await db.findFirst(driverCarrierRelationships, {
    where: and(eq(driverCarrierRelationships.driverId, driverId), activeRelationshipWindow())!,
  })
  return any?.carrierId ?? null
}

export interface InviteDriverUserInput {
  driverId: string
  email: string
  firstName: string
  lastName: string
}

export interface InviteDriverUserResult {
  invitationToken: string
  email: string
}

/**
 * Invites the person behind a driver record as a `driver`-role user of the
 * tenant. Reuses `server/auth/registration.ts`'s invitation issuance rather
 * than writing a second mechanism — the invitation carries both `carrierId`
 * and `driverId` so `acceptInvitation` can link `drivers.userId` and the new
 * membership's `driverId` together in one transaction (see that file).
 */
export async function inviteDriverUser(
  db: TenantDb,
  actor: Actor,
  input: InviteDriverUserInput,
): Promise<InviteDriverUserResult> {
  const driver = await db.requireById(drivers, input.driverId, 'driver')
  if (driver.userId) throw conflict('driver.errors.portalAlreadyLinked')

  const carrierId = await resolvePortalCarrierId(db, actor, driver.id)

  const invitationToken = await issueInvitation(db.tenantId, input.email, {
    role: 'driver',
    carrierId,
    driverId: driver.id,
    invitedByUserId: actor.userId,
    firstName: input.firstName,
    lastName: input.lastName,
  })

  const tenant = await db.builderRequiringExplicitTenantPredicate
    .select({ displayName: tenants.displayName })
    .from(tenants)
    .where(eq(tenants.id, db.tenantId))
    .limit(1)
    .then((rows) => rows[0])

  await sendInvitationEmail(input.email, invitationToken, actor.locale, {
    inviterName: `${actor.firstName} ${actor.lastName}`,
    tenantName: tenant?.displayName ?? '',
    role: 'driver',
  })

  return { invitationToken, email: input.email }
}

/** A still-live, unconsumed invitation carrying this driver's id — used to show "invitation pending" and to power resend/revoke. */
export async function findPendingDriverInvitation(
  db: TenantDb,
  driverId: string,
): Promise<{ email: string; invitedAt: Date; expiresAt: Date } | null> {
  const now = new Date()
  const candidates = await db.findMany(verificationTokens, {
    where: and(eq(verificationTokens.purpose, 'invitation'), isNull(verificationTokens.consumedAt), gt(verificationTokens.expiresAt, now))!,
    orderBy: desc(verificationTokens.createdAt),
  })
  const match = candidates.find((row) => (row.payload as Record<string, unknown> | null)?.driverId === driverId)
  if (!match || !match.email) return null
  return { email: match.email, invitedAt: match.createdAt, expiresAt: match.expiresAt }
}

/** Cancels every still-live invitation carrying this driver's id — "revoke" for a not-yet-accepted invite. */
export async function revokeDriverInvitation(db: TenantDb, _actor: { userId: string }, input: { driverId: string }): Promise<void> {
  const now = new Date()
  const candidates = await db.findMany(verificationTokens, {
    where: and(eq(verificationTokens.purpose, 'invitation'), isNull(verificationTokens.consumedAt), gt(verificationTokens.expiresAt, now))!,
  })
  const matches = candidates.filter((row) => (row.payload as Record<string, unknown> | null)?.driverId === input.driverId)
  for (const row of matches) {
    await db.update(verificationTokens, row.id, { consumedAt: now })
  }
}

export interface LinkExistingUserToDriverInput {
  driverId: string
  userId: string
}

/**
 * Links a person who already has an account in this tenant to a driver
 * record — the counterpart to `inviteDriverUser` for someone who doesn't
 * need a fresh invitation. The target must already hold a `driver`-role
 * membership in this tenant with no driver linked yet; both `drivers.userId`
 * and the membership's `driverId` are set together in one transaction, the
 * same pairing `acceptInvitation` maintains for the invite path.
 */
export async function linkExistingUserToDriver(
  db: TenantDb,
  _actor: { userId: string },
  input: LinkExistingUserToDriverInput,
): Promise<Driver> {
  const driver = await db.requireById(drivers, input.driverId, 'driver')
  if (driver.userId) throw conflict('driver.errors.portalAlreadyLinked')

  const membership = await db.findFirst(userTenantMemberships, {
    where: and(eq(userTenantMemberships.userId, input.userId), eq(userTenantMemberships.role, 'driver'))!,
  })
  if (!membership) throw notFound('driver.errors.userNotDriverMember')
  if (membership.driverId) throw conflict('driver.errors.userAlreadyLinkedToDriver')

  return db.transaction(async (tx) => {
    await tx.update(userTenantMemberships, membership.id, { driverId: driver.id })
    const updated = await tx.update(drivers, driver.id, { userId: input.userId })
    if (!updated) throw notFound('errors.notFound', { entity: 'driver' })
    return updated
  })
}

/** Removes the link between a driver record and its portal login, and suspends that membership so the login itself stops working. */
export async function unlinkDriverUser(db: TenantDb, _actor: { userId: string }, input: { driverId: string }): Promise<Driver> {
  const driver = await db.requireById(drivers, input.driverId, 'driver')
  if (!driver.userId) throw notFound('driver.errors.portalNotLinked')

  return db.transaction(async (tx) => {
    await tx.updateWhere(userTenantMemberships, eq(userTenantMemberships.driverId, driver.id), {
      driverId: null,
      status: 'suspended',
    })
    const updated = await tx.update(drivers, driver.id, { userId: null })
    if (!updated) throw notFound('errors.notFound', { entity: 'driver' })
    return updated
  })
}

export { activeRelationshipWindow }
