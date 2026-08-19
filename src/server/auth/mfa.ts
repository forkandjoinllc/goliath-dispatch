import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { mfaConfigurations, users } from '@/db/schema'
import {
  consumeRecoveryCode,
  createMfaEnrollment,
  verifyTotp,
  type MfaEnrollment,
} from '@/lib/auth/mfa'
import { markMfaSatisfied } from '@/lib/auth/session'
import { AppError, conflict, notFound } from '@/lib/errors'
import type { Role } from '@/lib/permissions'

/**
 * MFA orchestration against the database.
 *
 * `src/lib/auth/mfa.ts` holds the cryptographic primitives (TOTP secret
 * generation, QR rendering, recovery-code hashing). This module is the
 * stateful layer on top: enrolment, confirmation, challenge and disable.
 */

export const MFA_REQUIRED_ROLES: Role[] = ['admin', 'accounting']

export function roleRequiresMfa(role: Role | null): boolean {
  return role != null && MFA_REQUIRED_ROLES.includes(role)
}

export async function getMfaConfiguration(userId: string) {
  return unsafeDb
    .select()
    .from(mfaConfigurations)
    .where(and(eq(mfaConfigurations.userId, userId), isNull(mfaConfigurations.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export async function isMfaEnrolled(userId: string): Promise<boolean> {
  const config = await getMfaConfiguration(userId)
  return config != null && config.confirmedAt != null
}

/**
 * Begins enrolment. A pending (unconfirmed) configuration is replaced rather
 * than accumulated, so retrying setup does not leave orphaned secrets behind.
 */
export async function beginMfaEnrollment(userId: string, accountLabel: string): Promise<MfaEnrollment> {
  const enrollment = await createMfaEnrollment(accountLabel)

  const existing = await getMfaConfiguration(userId)
  if (existing?.confirmedAt) {
    throw conflict('errors.mfaAlreadyEnrolled')
  }

  if (existing) {
    await unsafeDb
      .update(mfaConfigurations)
      .set({
        secretEncrypted: enrollment.secretEncrypted,
        recoveryCodeHashes: enrollment.recoveryCodeHashes,
        confirmedAt: null,
        failedAttempts: 0,
      })
      .where(eq(mfaConfigurations.id, existing.id))
  } else {
    await unsafeDb.insert(mfaConfigurations).values({
      userId,
      method: 'totp',
      secretEncrypted: enrollment.secretEncrypted,
      recoveryCodeHashes: enrollment.recoveryCodeHashes,
    })
  }

  return enrollment
}

/**
 * Confirms enrolment with a TOTP code from the freshly scanned secret.
 *
 * The plaintext recovery codes are never regenerated or re-sent here: they
 * were produced once by `beginMfaEnrollment` and the setup UI holds them in
 * client-side state for the single "save these" screen it shows right after
 * this call succeeds. The server never re-exposes them from storage — only
 * their hashes exist from this point on.
 */
export async function confirmMfaEnrollment(userId: string, code: string): Promise<void> {
  const config = await getMfaConfiguration(userId)
  if (!config) throw notFound('errors.mfaNotEnrolled')
  if (config.confirmedAt) throw conflict('errors.mfaAlreadyEnrolled')

  if (!verifyTotp(config.secretEncrypted, code)) {
    throw new AppError('validation_failed', 'errors.mfaInvalidCode')
  }

  await unsafeDb
    .update(mfaConfigurations)
    .set({ confirmedAt: new Date() })
    .where(eq(mfaConfigurations.id, config.id))
}

export type MfaChallengeResult =
  | { ok: true; method: 'totp' | 'recovery' }
  | { ok: false; reasonKey: string }

export async function verifyMfaChallenge(
  userId: string,
  sessionId: string,
  input: { code?: string; recoveryCode?: string },
): Promise<MfaChallengeResult> {
  const config = await getMfaConfiguration(userId)
  if (!config || !config.confirmedAt) {
    return { ok: false, reasonKey: 'errors.mfaNotEnrolled' }
  }

  if (input.recoveryCode) {
    const { ok, remaining } = consumeRecoveryCode(input.recoveryCode, config.recoveryCodeHashes)
    if (!ok) {
      await bumpFailedAttempts(config.id)
      return { ok: false, reasonKey: 'auth.mfa.invalid' }
    }
    await unsafeDb
      .update(mfaConfigurations)
      .set({ recoveryCodeHashes: remaining, lastUsedAt: new Date(), failedAttempts: 0 })
      .where(eq(mfaConfigurations.id, config.id))
    await markMfaSatisfied(sessionId)
    return { ok: true, method: 'recovery' }
  }

  if (input.code && verifyTotp(config.secretEncrypted, input.code)) {
    await unsafeDb
      .update(mfaConfigurations)
      .set({ lastUsedAt: new Date(), failedAttempts: 0 })
      .where(eq(mfaConfigurations.id, config.id))
    await markMfaSatisfied(sessionId)
    return { ok: true, method: 'totp' }
  }

  await bumpFailedAttempts(config.id)
  return { ok: false, reasonKey: 'auth.mfa.invalid' }
}

async function bumpFailedAttempts(configId: string): Promise<void> {
  await unsafeDb
    .update(mfaConfigurations)
    .set({ failedAttempts: (await currentFailedAttempts(configId)) + 1 })
    .where(eq(mfaConfigurations.id, configId))
}

async function currentFailedAttempts(configId: string): Promise<number> {
  const [row] = await unsafeDb
    .select({ failedAttempts: mfaConfigurations.failedAttempts })
    .from(mfaConfigurations)
    .where(eq(mfaConfigurations.id, configId))
    .limit(1)
  return row?.failedAttempts ?? 0
}

export async function disableMfa(userId: string): Promise<void> {
  const config = await getMfaConfiguration(userId)
  if (!config) return
  await unsafeDb
    .update(mfaConfigurations)
    .set({ deletedAt: new Date(), deletionReason: 'user_disabled' })
    .where(eq(mfaConfigurations.id, config.id))
}

export async function accountLabelFor(userId: string): Promise<string> {
  const [user] = await unsafeDb
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return user?.email ?? 'user'
}
