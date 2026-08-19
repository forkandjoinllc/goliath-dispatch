import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { users } from '@/db/schema'
import { LOGIN_LOCKOUT_WINDOW_MINUTES, MAX_LOGIN_FAILURES, loginWithPassword } from '@/server/auth/login'
import { createTestMembership, createTestTenant, createTestUser, testLoginContext } from './fixtures'

describe('loginWithPassword', () => {
  it('succeeds with the right credentials, resolves the single membership as the active tenant, and creates a session', async () => {
    const tenant = await createTestTenant()
    const { user, password } = await createTestUser()
    await createTestMembership(tenant.id, user.id, 'admin')

    const outcome = await loginWithPassword({ email: user.email, password }, testLoginContext())

    expect(outcome.kind).toBe('success')
    if (outcome.kind === 'success') {
      expect(outcome.userId).toBe(user.id)
      expect(outcome.activeTenantId).toBe(tenant.id)
      expect(outcome.sessionToken).toBeTruthy()
      expect(outcome.mfaRequired).toBe(false)
    }
  })

  it('rejects a wrong password without revealing anything else', async () => {
    const { user } = await createTestUser()

    const outcome = await loginWithPassword({ email: user.email, password: 'TotallyWrongPass9' }, testLoginContext())

    expect(outcome).toEqual({ kind: 'invalid_credentials' })
  })

  it('runs a real bcrypt comparison even for an unknown email, so it cannot return near-instantly (no user-enumeration via timing)', async () => {
    const { user } = await createTestUser()

    async function median(email: string, samples: number): Promise<number> {
      const durations: number[] = []
      for (let i = 0; i < samples; i++) {
        const start = performance.now()
        await loginWithPassword({ email, password: 'DoesNotMatter9!' }, testLoginContext())
        durations.push(performance.now() - start)
      }
      durations.sort((a, b) => a - b)
      return durations[Math.floor(durations.length / 2)]!
    }

    // A single dummy `bcrypt.compare` against a fixed hash takes tens of
    // milliseconds at this codebase's cost factor (12 rounds) — the same
    // order of magnitude as comparing against a real hash. Warm up the
    // process once (module/JIT costs dominate a cold first call) then take
    // medians over several samples so the assertion isn't at the mercy of a
    // single slow tick.
    await median(user.email, 1)

    const knownEmailMs = await median(user.email, 5)
    const unknownEmailMs = await median(`nobody-${Date.now()}@example.test`, 5)

    // The floor proves the dummy-hash comparison actually ran (an
    // enumeration shortcut that skipped it would return in well under a
    // millisecond); the ratio proves it isn't dramatically cheaper than the
    // real-account path.
    expect(unknownEmailMs).toBeGreaterThan(10)
    const ratio = Math.max(knownEmailMs, unknownEmailMs) / Math.max(1, Math.min(knownEmailMs, unknownEmailMs))
    expect(ratio).toBeLessThan(10)
  })

  it('returns invalid_credentials — never a distinct "no such user" outcome — for an unknown email', async () => {
    const outcome = await loginWithPassword(
      { email: `nobody-${Date.now()}@example.test`, password: 'anything-at-all' },
      testLoginContext(),
    )
    expect(outcome).toEqual({ kind: 'invalid_credentials' })
  })

  it('locks the account after the configured number of consecutive failures', async () => {
    const { user } = await createTestUser()

    for (let i = 0; i < MAX_LOGIN_FAILURES; i++) {
      const outcome = await loginWithPassword({ email: user.email, password: 'WrongPassword9!' }, testLoginContext())
      expect(outcome.kind).toBe('invalid_credentials')
    }

    // The next attempt — even with the correct password — is locked out.
    const lockedOutcome = await loginWithPassword({ email: user.email, password: 'anything' }, testLoginContext())
    expect(lockedOutcome.kind).toBe('locked')
    if (lockedOutcome.kind === 'locked') {
      expect(lockedOutcome.minutesRemaining).toBeGreaterThan(0)
      expect(lockedOutcome.minutesRemaining).toBeLessThanOrEqual(LOGIN_LOCKOUT_WINDOW_MINUTES)
    }

    const [row] = await unsafeDb.select().from(users).where(eq(users.id, user.id)).limit(1)
    expect(row?.lockedUntil).not.toBeNull()
  })

  it('a locked account cannot log in even with the correct password', async () => {
    const { user, password } = await createTestUser()

    for (let i = 0; i < MAX_LOGIN_FAILURES; i++) {
      await loginWithPassword({ email: user.email, password: 'WrongPassword9!' }, testLoginContext())
    }

    const outcome = await loginWithPassword({ email: user.email, password }, testLoginContext())
    expect(outcome.kind).toBe('locked')
  })

  it('refuses a suspended user', async () => {
    const { user, password } = await createTestUser({ status: 'suspended' })
    const outcome = await loginWithPassword({ email: user.email, password }, testLoginContext())
    expect(outcome).toEqual({ kind: 'suspended' })
  })

  it('refuses a deactivated user', async () => {
    const { user, password } = await createTestUser({ status: 'deactivated' })
    const outcome = await loginWithPassword({ email: user.email, password }, testLoginContext())
    expect(outcome).toEqual({ kind: 'suspended' })
  })

  it('flags an unverified email instead of completing login', async () => {
    const { user, password } = await createTestUser({ status: 'pending_verification', emailVerifiedAt: null })
    const outcome = await loginWithPassword({ email: user.email, password }, testLoginContext())
    expect(outcome.kind).toBe('unverified')
    if (outcome.kind === 'unverified') {
      expect(outcome.userId).toBe(user.id)
      expect(outcome.email).toBe(user.email)
    }
  })

  it('refuses login when the user’s only tenant is suspended', async () => {
    const tenant = await createTestTenant({ status: 'suspended' })
    const { user, password } = await createTestUser()
    await createTestMembership(tenant.id, user.id, 'admin')

    const outcome = await loginWithPassword({ email: user.email, password }, testLoginContext())
    expect(outcome).toEqual({ kind: 'tenant_suspended' })
  })

  it('refuses login when the user’s only tenant is cancelled', async () => {
    const tenant = await createTestTenant({ status: 'cancelled' })
    const { user, password } = await createTestUser()
    await createTestMembership(tenant.id, user.id, 'admin')

    const outcome = await loginWithPassword({ email: user.email, password }, testLoginContext())
    expect(outcome).toEqual({ kind: 'tenant_suspended' })
  })

  it('a platform Super Admin with no tenant memberships logs in with a null active tenant', async () => {
    const { user, password } = await createTestUser({ isPlatformSuperAdmin: true })
    const outcome = await loginWithPassword({ email: user.email, password }, testLoginContext())
    expect(outcome.kind).toBe('success')
    if (outcome.kind === 'success') {
      expect(outcome.activeTenantId).toBeNull()
    }
  })

  it('resets the failure counter after a successful login', async () => {
    const { user, password } = await createTestUser()

    await loginWithPassword({ email: user.email, password: 'WrongPassword9!' }, testLoginContext())
    await loginWithPassword({ email: user.email, password: 'WrongPassword9!' }, testLoginContext())
    await loginWithPassword({ email: user.email, password }, testLoginContext())

    const [row] = await unsafeDb.select().from(users).where(eq(users.id, user.id)).limit(1)
    expect(row?.failedLoginAttempts).toBe(0)
    expect(row?.lockedUntil).toBeNull()
  })
})
