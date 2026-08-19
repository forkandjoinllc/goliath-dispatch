import { describe, expect, it } from 'vitest'
import { generateToken, hashToken } from '@/lib/crypto'
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  INVITATION_TTL_DAYS,
  PASSWORD_RESET_TTL_HOURS,
} from '@/server/auth/registration'

/**
 * Every auth token this codebase issues (email verification, password reset,
 * invitation) is built the same way: `generateToken()` for the raw value
 * handed to the user once, `hashToken()` for what actually lives in the
 * database. Neither of those steps touches Postgres, so the properties that
 * make the scheme safe belong here rather than in an integration test.
 */
describe('auth token primitives', () => {
  it('generateToken produces a long, URL-safe, unique value each call', () => {
    const a = generateToken()
    const b = generateToken()

    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('generateToken respects an explicit byte length', () => {
    const short = generateToken(8)
    const long = generateToken(64)
    expect(short.length).toBeLessThan(long.length)
  })

  it('hashToken is deterministic — the same raw token always hashes the same way', () => {
    const token = generateToken()
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('hashToken output never equals its input, and is a 64-character hex digest', () => {
    const token = generateToken()
    const hashed = hashToken(token)

    expect(hashed).not.toBe(token)
    expect(hashed).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashToken is sensitive to every character — no two distinct tokens collide in practice', () => {
    const tokens = Array.from({ length: 50 }, () => generateToken())
    const hashes = new Set(tokens.map(hashToken))
    expect(hashes.size).toBe(tokens.length)
  })

  it('token lifetimes match the documented policy', () => {
    expect(EMAIL_VERIFICATION_TTL_HOURS).toBe(24)
    expect(PASSWORD_RESET_TTL_HOURS).toBe(1)
    expect(INVITATION_TTL_DAYS).toBe(7)

    // Password reset must expire strictly sooner than email verification —
    // it grants control over an existing account, not just confirms an inbox.
    expect(PASSWORD_RESET_TTL_HOURS).toBeLessThan(EMAIL_VERIFICATION_TTL_HOURS)
  })
})
