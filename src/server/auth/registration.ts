import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { drivers, tenants, userTenantMemberships, users, verificationTokens } from '@/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { revokeAllUserSessions } from '@/lib/auth/session'
import { generateToken, hashToken } from '@/lib/crypto'
import { conflict, notFound } from '@/lib/errors'
import { normalizeEmail } from '@/lib/utils'
import { publicEnv } from '@/lib/env'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { getEmailProvider, renderEmailShell } from '@/integrations/email'
import type { Locale } from '@/i18n/config'
import type { Role } from '@/lib/permissions'

/**
 * Token-based registration flows: email verification, password reset and
 * invitation acceptance.
 *
 * Every issued token follows the same shape: a random 32-byte value is
 * returned to the caller exactly once (to be emailed), and only its SHA-256
 * digest is ever persisted. A token is single-use — `consumedAt` is set the
 * moment it is redeemed — and every purpose has its own expiry.
 */

export const EMAIL_VERIFICATION_TTL_HOURS = 24
export const PASSWORD_RESET_TTL_HOURS = 1
export const INVITATION_TTL_DAYS = 7

type TokenPurpose = 'email_verification' | 'password_reset' | 'invitation'

async function issueToken(input: {
  purpose: TokenPurpose
  userId?: string | null
  tenantId?: string | null
  email?: string | null
  payload?: Record<string, unknown>
  ttlMs: number
}): Promise<string> {
  const token = generateToken(32)
  await unsafeDb.insert(verificationTokens).values({
    purpose: input.purpose,
    userId: input.userId ?? null,
    tenantId: input.tenantId ?? null,
    email: input.email ?? null,
    payload: input.payload ?? {},
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + input.ttlMs),
  })
  return token
}

async function findLiveToken(purpose: TokenPurpose, rawToken: string) {
  return unsafeDb
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.tokenHash, hashToken(rawToken)),
        eq(verificationTokens.purpose, purpose),
        isNull(verificationTokens.consumedAt),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() < Date.now()
}

/* ── Email verification ─────────────────────────────────────────────────── */

export async function issueEmailVerificationToken(userId: string, email: string): Promise<string> {
  return issueToken({
    purpose: 'email_verification',
    userId,
    email: normalizeEmail(email),
    ttlMs: EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
  })
}

export type ConsumeVerificationResult =
  | { ok: true; userId: string }
  | { ok: false; reasonKey: 'auth.verify.expired' | 'errors.notFound' }

export async function consumeEmailVerificationToken(rawToken: string): Promise<ConsumeVerificationResult> {
  const row = await findLiveToken('email_verification', rawToken)
  if (!row || !row.userId) return { ok: false, reasonKey: 'errors.notFound' }
  if (isExpired(row.expiresAt)) return { ok: false, reasonKey: 'auth.verify.expired' }

  await unsafeDb.transaction(async (tx) => {
    await tx
      .update(verificationTokens)
      .set({ consumedAt: new Date() })
      .where(eq(verificationTokens.id, row.id))
    await tx
      .update(users)
      .set({ emailVerifiedAt: new Date(), status: 'active' })
      .where(eq(users.id, row.userId!))
  })

  return { ok: true, userId: row.userId }
}

/* ── Password reset ─────────────────────────────────────────────────────── */

/** Returns null when no account exists — callers must not reveal this to the client. */
export async function issuePasswordResetToken(email: string): Promise<{ token: string; userId: string } | null> {
  const emailNormalized = normalizeEmail(email) ?? ''
  const user = await unsafeDb
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!user || user.status === 'suspended' || user.status === 'deactivated') return null

  const token = await issueToken({
    purpose: 'password_reset',
    userId: user.id,
    email: emailNormalized,
    ttlMs: PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000,
  })
  return { token, userId: user.id }
}

export type ConsumePasswordResetResult =
  | { ok: true; userId: string }
  | { ok: false; reasonKey: 'auth.forgot.expired' | 'errors.notFound' }

/** Consuming a reset revokes every other session for that user. */
export async function consumePasswordResetToken(
  rawToken: string,
  newPassword: string,
): Promise<ConsumePasswordResetResult> {
  const row = await findLiveToken('password_reset', rawToken)
  if (!row || !row.userId) return { ok: false, reasonKey: 'errors.notFound' }
  if (isExpired(row.expiresAt)) return { ok: false, reasonKey: 'auth.forgot.expired' }

  const passwordHash = await hashPassword(newPassword)

  await unsafeDb.transaction(async (tx) => {
    await tx
      .update(verificationTokens)
      .set({ consumedAt: new Date() })
      .where(eq(verificationTokens.id, row.id))
    await tx
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        mustChangePassword: false,
      })
      .where(eq(users.id, row.userId!))
  })

  await revokeAllUserSessions(row.userId, 'password_reset')

  return { ok: true, userId: row.userId }
}

/* ── Invitations ─────────────────────────────────────────────────────────── */

export interface InvitationPayload {
  role: Role
  carrierId?: string | null
  driverId?: string | null
  invitedByUserId: string
  firstName?: string
  lastName?: string
}

export async function issueInvitation(
  tenantId: string,
  email: string,
  payload: InvitationPayload,
): Promise<string> {
  const emailNormalized = normalizeEmail(email) ?? ''
  return issueToken({
    purpose: 'invitation',
    tenantId,
    email: emailNormalized,
    payload: { ...payload },
    ttlMs: INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
  })
}

export interface InvitationDetails {
  tenantId: string
  tenantName: string
  email: string
  role: Role
  carrierId: string | null
  driverId: string | null
  invitedByUserId: string
}

export type ReadInvitationResult =
  | { ok: true; invitation: InvitationDetails }
  | { ok: false; reasonKey: 'auth.invite.expired' | 'errors.notFound' }

export async function readInvitation(rawToken: string): Promise<ReadInvitationResult> {
  const row = await findLiveToken('invitation', rawToken)
  if (!row || !row.tenantId || !row.email) return { ok: false, reasonKey: 'errors.notFound' }
  if (isExpired(row.expiresAt)) return { ok: false, reasonKey: 'auth.invite.expired' }

  const tenant = await unsafeDb
    .select({ displayName: tenants.displayName })
    .from(tenants)
    .where(eq(tenants.id, row.tenantId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!tenant) return { ok: false, reasonKey: 'errors.notFound' }

  const payload = (row.payload ?? {}) as Partial<InvitationPayload>
  if (!payload.role) return { ok: false, reasonKey: 'errors.notFound' }

  return {
    ok: true,
    invitation: {
      tenantId: row.tenantId,
      tenantName: tenant.displayName,
      email: row.email,
      role: payload.role,
      carrierId: payload.carrierId ?? null,
      driverId: payload.driverId ?? null,
      invitedByUserId: payload.invitedByUserId ?? '',
    },
  }
}

export interface AcceptInvitationInput {
  firstName: string
  lastName: string
  password: string
  locale: Locale
  timezone: string
}

export type AcceptInvitationResult =
  | { ok: true; userId: string; tenantId: string }
  | { ok: false; reasonKey: string }

/**
 * Accepting an invitation creates the user (or attaches the membership to an
 * existing account with the same email) inside one transaction, so a crash
 * mid-way never leaves an orphaned membership or a half-verified user.
 */
export async function acceptInvitation(
  rawToken: string,
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const row = await findLiveToken('invitation', rawToken)
  if (!row || !row.tenantId || !row.email) return { ok: false, reasonKey: 'errors.notFound' }
  if (isExpired(row.expiresAt)) return { ok: false, reasonKey: 'auth.invite.expired' }

  const payload = (row.payload ?? {}) as Partial<InvitationPayload>
  if (!payload.role) return { ok: false, reasonKey: 'errors.notFound' }

  const emailNormalized = normalizeEmail(row.email) ?? ''
  const tenantId = row.tenantId

  const result = await unsafeDb.transaction(async (tx) => {
    const existingMembership = await tx
      .select({ id: userTenantMemberships.id })
      .from(userTenantMemberships)
      .innerJoin(users, eq(users.id, userTenantMemberships.userId))
      .where(
        and(
          eq(userTenantMemberships.tenantId, tenantId),
          eq(users.emailNormalized, emailNormalized),
          isNull(userTenantMemberships.deletedAt),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (existingMembership) {
      throw conflict('errors.conflict')
    }

    let user = await tx
      .select()
      .from(users)
      .where(eq(users.emailNormalized, emailNormalized))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!user) {
      const passwordHash = await hashPassword(input.password)
      const [created] = await tx
        .insert(users)
        .values({
          email: row.email!,
          emailNormalized,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          locale: input.locale,
          timezone: input.timezone,
          status: 'active',
          emailVerifiedAt: new Date(),
        })
        .returning()
      user = created!
    }

    await tx.insert(userTenantMemberships).values({
      tenantId,
      userId: user.id,
      role: payload.role!,
      status: 'active',
      carrierId: payload.carrierId ?? null,
      driverId: payload.driverId ?? null,
      invitedByUserId: payload.invitedByUserId ?? null,
      invitedAt: row.createdAt,
      acceptedAt: new Date(),
    })

    // A driver invitation's whole point is to link the new login back to the
    // driver record it was issued for — without this, `drivers.userId` stays
    // null forever and `startTrackingSession`'s consent check (and every
    // other place that resolves "which driver is this user") can never
    // succeed for a driver who signed up through an invitation. Scoped to
    // `tenantId` the same way every other write in this transaction is,
    // even though `drivers` has no tenant-guard trigger of its own to lean on.
    if (payload.driverId) {
      await tx
        .update(drivers)
        .set({ userId: user.id })
        .where(and(eq(drivers.id, payload.driverId), eq(drivers.tenantId, tenantId)))
    }

    await tx
      .update(verificationTokens)
      .set({ consumedAt: new Date() })
      .where(eq(verificationTokens.id, row.id))

    return { userId: user.id, tenantId }
  })

  return { ok: true, ...result }
}

/**
 * Delivers the invitation email — the "return the raw token exactly once,
 * to be emailed" contract this file's header comment describes. Every
 * caller of `issueInvitation` must call this (or an equivalent) with the
 * result; `issueInvitation` itself stays transport-agnostic so it can be
 * called from inside a transaction without a network call in the middle.
 */
export async function sendInvitationEmail(
  email: string,
  token: string,
  locale: Locale,
  params: { inviterName: string; tenantName: string; role: Role },
): Promise<void> {
  const dictionary = await getDictionary(locale, ['auth', 'common'])
  const t = createTranslator(dictionary, locale)
  const roleKey = `nav.roles.${params.role}`
  const roleLabel = t(roleKey) === roleKey ? params.role : t(roleKey)
  const link = `${publicEnv.NEXT_PUBLIC_APP_URL}/${locale}/accept-invitation/${token}`

  const subject = t('auth.invite.emailSubject', { tenant: params.tenantName })
  const bodyText = t('auth.invite.emailBody', {
    inviter: params.inviterName,
    tenant: params.tenantName,
    role: roleLabel,
    link,
  })
  const { html, text } = renderEmailShell({
    locale,
    branding: { tenantDisplayName: params.tenantName },
    bodyHtml: `<p>${bodyText}</p>`,
    bodyText,
  })
  await getEmailProvider().send({ to: email, subject, html, text, tags: ['invitation'] })
}

export async function requireUserById(userId: string) {
  const user = await unsafeDb.select().from(users).where(eq(users.id, userId)).limit(1).then((r) => r[0])
  if (!user) throw notFound('errors.notFound')
  return user
}
