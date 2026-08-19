import 'server-only'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { loginAttempts, sessions, users, userTenantMemberships, tenants } from '@/db/schema'
import { verifyPassword } from '@/lib/auth/password'
import { createSession, type CreateSessionInput } from '@/lib/auth/session'
import { normalizeEmail } from '@/lib/utils'
import { isMfaEnrolled } from './mfa'

/**
 * Core login logic.
 *
 * Deliberately framework-agnostic: no Zod, no rate limiting, no cookies. Those
 * belong to `actions.ts`, which is pre-authentication and therefore cannot use
 * `defineAction`. Keeping this module pure makes it directly unit/integration
 * testable and keeps the constant-time guarantee in one obvious place.
 */

export const MAX_LOGIN_FAILURES = 8
export const LOGIN_LOCKOUT_WINDOW_MINUTES = 15

export interface LoginAttemptContext {
  ipAddress: string | null
  userAgent: string | null
}

export type LoginOutcome =
  | { kind: 'success'; userId: string; sessionToken: string; sessionExpiresAt: Date; mfaRequired: boolean; activeTenantId: string | null }
  | { kind: 'invalid_credentials' }
  | { kind: 'locked'; minutesRemaining: number }
  | { kind: 'suspended' }
  | { kind: 'unverified'; userId: string; email: string }
  | { kind: 'tenant_suspended' }

/**
 * Verifies credentials and, on success, creates the session.
 *
 * The bcrypt comparison always runs — even when the email does not exist —
 * so a request against an unknown address takes a comparable amount of time
 * to one against a real, wrong password. `verifyPassword` handles the
 * missing-hash case with its own dummy comparison; this function never
 * short-circuits before that call.
 */
export async function loginWithPassword(
  input: { email: string; password: string; remember?: boolean },
  ctx: LoginAttemptContext,
): Promise<LoginOutcome> {
  const emailNormalized = normalizeEmail(input.email) ?? ''

  const user = await unsafeDb
    .select()
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  const isLocked = user?.lockedUntil != null && user.lockedUntil.getTime() > Date.now()

  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? null)

  // The attempt is recorded regardless of outcome — the ledger is what powers
  // both the lockout counter and the security audit trail.
  await recordLoginAttempt(emailNormalized, ctx, passwordOk && !isLocked, isLocked ? 'locked' : undefined)

  if (isLocked) {
    const minutesRemaining = Math.max(1, Math.ceil((user!.lockedUntil!.getTime() - Date.now()) / 60_000))
    return { kind: 'locked', minutesRemaining }
  }

  if (!user || !passwordOk) {
    if (user) await registerFailure(user.id)
    return { kind: 'invalid_credentials' }
  }

  if (user.status === 'suspended' || user.status === 'deactivated') {
    return { kind: 'suspended' }
  }

  if (user.status === 'pending_verification' || !user.emailVerifiedAt) {
    return { kind: 'unverified', userId: user.id, email: user.email }
  }

  const activeTenantId = await chooseActiveTenant(user.id, user.isPlatformSuperAdmin)

  if (activeTenantId) {
    const tenant = await unsafeDb
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, activeTenantId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (tenant?.status === 'suspended' || tenant?.status === 'cancelled') {
      return { kind: 'tenant_suspended' }
    }
  }

  // Successful login resets the failure counter.
  await unsafeDb
    .update(users)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: ctx.ipAddress,
    })
    .where(eq(users.id, user.id))

  const mfaEnrolled = await isMfaEnrolled(user.id)

  const sessionInput: CreateSessionInput = {
    userId: user.id,
    activeTenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    remember: input.remember,
    mfaSatisfied: !mfaEnrolled,
  }
  const { token, session } = await createSession(sessionInput)

  return {
    kind: 'success',
    userId: user.id,
    sessionToken: token,
    sessionExpiresAt: session.expiresAt,
    mfaRequired: mfaEnrolled,
    activeTenantId,
  }
}

async function registerFailure(userId: string): Promise<void> {
  const [user] = await unsafeDb
    .select({ failedLoginAttempts: users.failedLoginAttempts })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const nextCount = (user?.failedLoginAttempts ?? 0) + 1
  const lockedUntil =
    nextCount >= MAX_LOGIN_FAILURES
      ? new Date(Date.now() + LOGIN_LOCKOUT_WINDOW_MINUTES * 60_000)
      : null

  await unsafeDb
    .update(users)
    .set({ failedLoginAttempts: nextCount, lockedUntil: lockedUntil ?? undefined })
    .where(eq(users.id, userId))
}

async function recordLoginAttempt(
  emailNormalized: string,
  ctx: LoginAttemptContext,
  successful: boolean,
  failureReason?: string,
): Promise<void> {
  await unsafeDb.insert(loginAttempts).values({
    emailNormalized,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    successful,
    failureReason: successful ? null : (failureReason ?? 'invalid_credentials'),
  })
}

/**
 * Single active membership → that tenant. Several → the most recently used
 * (the tenant on the user's most recent non-revoked session). None, but a
 * platform Super Admin → `null` (they operate platform-wide until they open
 * an explicit tenant support session).
 */
async function chooseActiveTenant(userId: string, isPlatformSuperAdmin: boolean): Promise<string | null> {
  const memberships = await unsafeDb
    .select({ tenantId: userTenantMemberships.tenantId })
    .from(userTenantMemberships)
    .where(
      and(
        eq(userTenantMemberships.userId, userId),
        eq(userTenantMemberships.status, 'active'),
        isNull(userTenantMemberships.deletedAt),
      ),
    )

  if (memberships.length === 0) return isPlatformSuperAdmin ? null : null
  if (memberships.length === 1) return memberships[0]!.tenantId

  const mostRecent = await unsafeDb
    .select({ tenantId: sessions.activeTenantId })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(1)
    .then((rows) => rows[0]?.tenantId ?? null)

  const membershipIds = new Set(memberships.map((m) => m.tenantId))
  if (mostRecent && membershipIds.has(mostRecent)) return mostRecent

  return memberships[0]!.tenantId
}
