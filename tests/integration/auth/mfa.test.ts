import { authenticator } from 'otplib'
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { sessions } from '@/db/schema'
import { decryptField } from '@/lib/crypto'
import { createSession } from '@/lib/auth/session'
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa,
  isMfaEnrolled,
  roleRequiresMfa,
  verifyMfaChallenge,
} from '@/server/auth/mfa'
import { createTestUser } from './fixtures'

describe('MFA enrolment and the Admin/Accounting requirement', () => {
  it('roleRequiresMfa is true for admin and accounting, false for every other role', () => {
    expect(roleRequiresMfa('admin')).toBe(true)
    expect(roleRequiresMfa('accounting')).toBe(true)
    expect(roleRequiresMfa('dispatcher')).toBe(false)
    expect(roleRequiresMfa('carrier')).toBe(false)
    expect(roleRequiresMfa('driver')).toBe(false)
    expect(roleRequiresMfa(null)).toBe(false)
  })

  it('an Admin is not enrolled until they complete setup — this is exactly the fact the app shell layout gates on', async () => {
    const { user } = await createTestUser()
    expect(await isMfaEnrolled(user.id)).toBe(false)

    const enrollment = await beginMfaEnrollment(user.id, user.email)
    // Still not enrolled — begin only stages a pending, unconfirmed secret.
    expect(await isMfaEnrolled(user.id)).toBe(false)

    const secret = decryptField(enrollment.secretEncrypted)
    const code = authenticator.generate(secret)
    await confirmMfaEnrollment(user.id, code)

    expect(await isMfaEnrolled(user.id)).toBe(true)
  })

  it('rejects confirmation with the wrong code and leaves enrolment unconfirmed', async () => {
    const { user } = await createTestUser()
    await beginMfaEnrollment(user.id, user.email)

    await expect(confirmMfaEnrollment(user.id, '000000')).rejects.toMatchObject({ messageKey: 'errors.mfaInvalidCode' })
    expect(await isMfaEnrolled(user.id)).toBe(false)
  })

  it('re-running begin on an already-confirmed account is refused, not silently reset', async () => {
    const { user } = await createTestUser()
    const enrollment = await beginMfaEnrollment(user.id, user.email)
    const code = authenticator.generate(decryptField(enrollment.secretEncrypted))
    await confirmMfaEnrollment(user.id, code)

    await expect(beginMfaEnrollment(user.id, user.email)).rejects.toMatchObject({
      messageKey: 'errors.mfaAlreadyEnrolled',
    })
  })

  it('a confirmed challenge marks the session mfa-satisfied', async () => {
    const { user } = await createTestUser()
    const enrollment = await beginMfaEnrollment(user.id, user.email)
    const secret = decryptField(enrollment.secretEncrypted)
    await confirmMfaEnrollment(user.id, authenticator.generate(secret))

    const { session } = await createSession({
      userId: user.id,
      activeTenantId: null,
      ipAddress: '203.0.113.20',
      userAgent: 'vitest',
      mfaSatisfied: false,
    })
    expect(session.mfaSatisfiedAt).toBeNull()

    const result = await verifyMfaChallenge(user.id, session.id, { code: authenticator.generate(secret) })
    expect(result).toEqual({ ok: true, method: 'totp' })

    const [row] = await unsafeDb.select().from(sessions).where(eq(sessions.id, session.id)).limit(1)
    expect(row?.mfaSatisfiedAt).not.toBeNull()
  })

  it('a recovery code satisfies the challenge exactly once', async () => {
    const { user } = await createTestUser()
    const enrollment = await beginMfaEnrollment(user.id, user.email)
    await confirmMfaEnrollment(user.id, authenticator.generate(decryptField(enrollment.secretEncrypted)))

    const { session } = await createSession({
      userId: user.id,
      activeTenantId: null,
      ipAddress: '203.0.113.21',
      userAgent: 'vitest',
      mfaSatisfied: false,
    })

    const recoveryCode = enrollment.recoveryCodes[0]!
    const first = await verifyMfaChallenge(user.id, session.id, { recoveryCode })
    expect(first).toEqual({ ok: true, method: 'recovery' })

    const { session: secondSession } = await createSession({
      userId: user.id,
      activeTenantId: null,
      ipAddress: '203.0.113.22',
      userAgent: 'vitest',
      mfaSatisfied: false,
    })
    const replay = await verifyMfaChallenge(user.id, secondSession.id, { recoveryCode })
    expect(replay.ok).toBe(false)
  })

  it('disableMfa removes enrolment so the account reverts to not-enrolled', async () => {
    const { user } = await createTestUser()
    const enrollment = await beginMfaEnrollment(user.id, user.email)
    await confirmMfaEnrollment(user.id, authenticator.generate(decryptField(enrollment.secretEncrypted)))
    expect(await isMfaEnrolled(user.id)).toBe(true)

    await disableMfa(user.id)
    expect(await isMfaEnrolled(user.id)).toBe(false)
  })
})
