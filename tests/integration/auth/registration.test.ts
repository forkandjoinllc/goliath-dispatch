import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { sessions, userTenantMemberships, users } from '@/db/schema'
import { createSession } from '@/lib/auth/session'
import {
  acceptInvitation,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  issueEmailVerificationToken,
  issueInvitation,
  issuePasswordResetToken,
  readInvitation,
} from '@/server/auth/registration'
import { createTestTenant, createTestUser } from './fixtures'

describe('email verification tokens', () => {
  it('verifies the account and marks the email as verified', async () => {
    const { user } = await createTestUser({ status: 'pending_verification', emailVerifiedAt: null })
    const token = await issueEmailVerificationToken(user.id, user.email)

    const result = await consumeEmailVerificationToken(token)

    expect(result).toEqual({ ok: true, userId: user.id })
    const [row] = await unsafeDb.select().from(users).where(eq(users.id, user.id)).limit(1)
    expect(row?.emailVerifiedAt).not.toBeNull()
    expect(row?.status).toBe('active')
  })

  it('is single-use — a second redemption fails', async () => {
    const { user } = await createTestUser({ status: 'pending_verification', emailVerifiedAt: null })
    const token = await issueEmailVerificationToken(user.id, user.email)

    await consumeEmailVerificationToken(token)
    const second = await consumeEmailVerificationToken(token)

    expect(second.ok).toBe(false)
  })

  it('rejects an unrecognized token', async () => {
    const result = await consumeEmailVerificationToken('not-a-real-token')
    expect(result).toEqual({ ok: false, reasonKey: 'errors.notFound' })
  })
})

describe('password reset tokens', () => {
  it('does not reveal whether the email exists', async () => {
    const result = await issuePasswordResetToken(`nobody-${Date.now()}@example.test`)
    expect(result).toBeNull()
  })

  it('changes the password and revokes every other session for that user', async () => {
    const { user } = await createTestUser()

    const { session: keepAliveOther } = await createSession({
      userId: user.id,
      activeTenantId: null,
      ipAddress: '203.0.113.1',
      userAgent: 'device-a',
    })
    const { session: another } = await createSession({
      userId: user.id,
      activeTenantId: null,
      ipAddress: '203.0.113.2',
      userAgent: 'device-b',
    })

    const issued = await issuePasswordResetToken(user.email)
    expect(issued).not.toBeNull()

    const result = await consumePasswordResetToken(issued!.token, 'BrandNewPassphrase9')
    expect(result).toEqual({ ok: true, userId: user.id })

    const [rowA] = await unsafeDb.select().from(sessions).where(eq(sessions.id, keepAliveOther.id)).limit(1)
    const [rowB] = await unsafeDb.select().from(sessions).where(eq(sessions.id, another.id)).limit(1)
    expect(rowA?.revokedAt).not.toBeNull()
    expect(rowB?.revokedAt).not.toBeNull()
    expect(rowA?.revokedReason).toBe('password_reset')

    const [userRow] = await unsafeDb.select().from(users).where(eq(users.id, user.id)).limit(1)
    expect(userRow?.passwordHash).not.toBe(user.passwordHash)
  })

  it('is single-use and rejects a second redemption', async () => {
    const { user } = await createTestUser()
    const issued = await issuePasswordResetToken(user.email)

    await consumePasswordResetToken(issued!.token, 'FirstNewPassphrase9')
    const second = await consumePasswordResetToken(issued!.token, 'SecondNewPassphrase9')

    expect(second.ok).toBe(false)
  })
})

describe('invitations', () => {
  it('creates a membership with exactly the role and carrier/driver linkage carried in the invitation', async () => {
    const tenant = await createTestTenant()
    const { user: inviter } = await createTestUser({ firstName: 'Owner', lastName: 'Admin' })
    const carrierId = crypto.randomUUID()

    const token = await issueInvitation(tenant.id, 'new-driver@example.test', {
      role: 'driver',
      carrierId,
      invitedByUserId: inviter.id,
    })

    const read = await readInvitation(token)
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.invitation.role).toBe('driver')
      expect(read.invitation.carrierId).toBe(carrierId)
      expect(read.invitation.tenantId).toBe(tenant.id)
    }

    const result = await acceptInvitation(token, {
      firstName: 'New',
      lastName: 'Driver',
      password: 'AcceptThisInvite9',
      locale: 'en',
      timezone: 'America/Chicago',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [membership] = await unsafeDb
      .select()
      .from(userTenantMemberships)
      .where(eq(userTenantMemberships.userId, result.userId))
      .limit(1)

    expect(membership?.tenantId).toBe(tenant.id)
    expect(membership?.role).toBe('driver')
    expect(membership?.carrierId).toBe(carrierId)
    expect(membership?.status).toBe('active')
  })

  it('is single-use — accepting twice fails the second time', async () => {
    const tenant = await createTestTenant()
    const { user: inviter } = await createTestUser()
    const token = await issueInvitation(tenant.id, 'twice@example.test', {
      role: 'dispatcher',
      invitedByUserId: inviter.id,
    })

    const first = await acceptInvitation(token, {
      firstName: 'First',
      lastName: 'Try',
      password: 'FirstAcceptance9',
      locale: 'en',
      timezone: 'America/Chicago',
    })
    expect(first.ok).toBe(true)

    await expect(
      acceptInvitation(token, {
        firstName: 'Second',
        lastName: 'Try',
        password: 'SecondAcceptance9',
        locale: 'en',
        timezone: 'America/Chicago',
      }),
    ).resolves.toMatchObject({ ok: false })
  })

  it('rejects an expired invitation', async () => {
    const tenant = await createTestTenant()
    const { user: inviter } = await createTestUser()
    const token = await issueInvitation(tenant.id, 'expired@example.test', {
      role: 'dispatcher',
      invitedByUserId: inviter.id,
    })

    // Force the token's expiry into the past directly — this suite tests the
    // expiry check, not the clock, and the token schema exposes no "issue
    // with a custom TTL" seam worth adding just for a test.
    const { verificationTokens } = await import('@/db/schema')
    const { hashToken } = await import('@/lib/crypto')
    await unsafeDb
      .update(verificationTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verificationTokens.tokenHash, hashToken(token)))

    const read = await readInvitation(token)
    expect(read).toEqual({ ok: false, reasonKey: 'auth.invite.expired' })
  })
})
