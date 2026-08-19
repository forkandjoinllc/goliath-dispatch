import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkRateLimit, rateLimitPolicies, resetMemoryRateLimits } from '@/lib/rate-limit'

/**
 * The memory driver's fixed-window behaviour. `RATE_LIMIT_DRIVER` defaults to
 * `memory` (see `src/lib/env.ts`), which is what every unit test run uses —
 * no database connection involved.
 */
describe('rate-limit (memory driver)', () => {
  beforeEach(() => {
    resetMemoryRateLimits()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests up to the limit and blocks the one after', async () => {
    const policy = { key: 'test:fixed-window', limit: 3, windowSeconds: 60 }

    const first = await checkRateLimit(policy)
    const second = await checkRateLimit(policy)
    const third = await checkRateLimit(policy)
    const fourth = await checkRateLimit(policy)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third.allowed).toBe(true)
    expect(fourth.allowed).toBe(false)
    expect(fourth.remaining).toBe(0)
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('tracks each key independently', async () => {
    const policyA = { key: 'test:key-a', limit: 1, windowSeconds: 60 }
    const policyB = { key: 'test:key-b', limit: 1, windowSeconds: 60 }

    const a1 = await checkRateLimit(policyA)
    const b1 = await checkRateLimit(policyB)
    const a2 = await checkRateLimit(policyA)

    expect(a1.allowed).toBe(true)
    expect(b1.allowed).toBe(true)
    expect(a2.allowed).toBe(false)
  })

  it('resets once the window boundary is crossed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const policy = { key: 'test:window-reset', limit: 1, windowSeconds: 60 }

    const first = await checkRateLimit(policy)
    expect(first.allowed).toBe(true)

    const blocked = await checkRateLimit(policy)
    expect(blocked.allowed).toBe(false)

    // Advance past the 60-second fixed window — windows are computed from
    // `Date.now()` floor-divided by the window size, so this crosses into a
    // fresh bucket without needing to touch the module's internal state.
    vi.setSystemTime(new Date('2026-01-01T00:01:01.000Z'))
    const afterWindow = await checkRateLimit(policy)
    expect(afterWindow.allowed).toBe(true)
  })

  it('decrements remaining on each allowed request', async () => {
    const policy = { key: 'test:remaining', limit: 5, windowSeconds: 60 }

    const first = await checkRateLimit(policy)
    const second = await checkRateLimit(policy)

    expect(first.remaining).toBe(4)
    expect(second.remaining).toBe(3)
  })

  it('every named policy factory produces a stable, distinct bucket key', () => {
    const loginByEmail = rateLimitPolicies.loginByEmail('user@example.com')
    const loginByIp = rateLimitPolicies.loginByIp('203.0.113.5')

    expect(loginByEmail.key).toContain('user@example.com')
    expect(loginByIp.key).toContain('203.0.113.5')
    expect(loginByEmail.key).not.toBe(loginByIp.key)
    expect(loginByEmail.limit).toBe(8)
    expect(loginByEmail.windowSeconds).toBe(15 * 60)
  })
})
