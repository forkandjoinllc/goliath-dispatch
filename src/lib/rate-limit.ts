import 'server-only'
import { sql } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { rateLimitBuckets } from '@/db/schema'
import { serverEnv } from '@/lib/env'
import { recordAudit, type AuditRequestContext } from '@/lib/audit'

/**
 * Fixed-window rate limiting.
 *
 * Two drivers, selected by `RATE_LIMIT_DRIVER`:
 *  - `memory`   — a process-local Map. Correct for a single Node process and
 *                 for tests; does NOT coordinate across serverless instances.
 *  - `database` — the `rate_limit_buckets` table. Slightly slower, correct
 *                 everywhere, including multiple concurrent Vercel functions.
 *
 * Windows are fixed (not sliding): a key's count resets the instant the wall
 * clock crosses a window boundary of `windowSeconds`. This is simpler than a
 * sliding window and adequate for abuse prevention, which cares about "not
 * more than N per window", not exact request spacing.
 */

export interface CheckRateLimitInput {
  key: string
  limit: number
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

function windowStartMs(windowSeconds: number, now: number): number {
  const windowMs = windowSeconds * 1000
  return Math.floor(now / windowMs) * windowMs
}

/* ── Memory driver ───────────────────────────────────────────────────────── */

interface MemoryBucket {
  windowStart: number
  count: number
}

const memoryBuckets = new Map<string, MemoryBucket>()

function checkMemory({ key, limit, windowSeconds }: CheckRateLimitInput): RateLimitResult {
  const now = Date.now()
  const start = windowStartMs(windowSeconds, now)
  const existing = memoryBuckets.get(key)

  if (!existing || existing.windowStart !== start) {
    memoryBuckets.set(key, { windowStart: start, count: 1 })
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 }
  }

  const retryAfterSeconds = Math.max(0, Math.ceil((start + windowSeconds * 1000 - now) / 1000))
  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds }
  }

  existing.count += 1
  return { allowed: true, remaining: Math.max(0, limit - existing.count), retryAfterSeconds: 0 }
}

/** Test-only: clears every in-memory bucket. */
export function resetMemoryRateLimits(): void {
  memoryBuckets.clear()
}

/* ── Database driver ─────────────────────────────────────────────────────── */

async function checkDatabase({ key, limit, windowSeconds }: CheckRateLimitInput): Promise<RateLimitResult> {
  const now = Date.now()
  const startMs = windowStartMs(windowSeconds, now)
  const windowStart = new Date(startMs)

  const [row] = await unsafeDb
    .insert(rateLimitBuckets)
    .values({ bucketKey: key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.bucketKey, rateLimitBuckets.windowStart],
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count })

  const count = row?.count ?? 1
  const retryAfterSeconds = Math.max(0, Math.ceil((startMs + windowSeconds * 1000 - now) / 1000))

  if (count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds }
  }
  return { allowed: true, remaining: Math.max(0, limit - count), retryAfterSeconds: 0 }
}

/* ── Public API ──────────────────────────────────────────────────────────── */

export async function checkRateLimit(input: CheckRateLimitInput): Promise<RateLimitResult> {
  const driver = serverEnv().RATE_LIMIT_DRIVER
  return driver === 'database' ? checkDatabase(input) : checkMemory(input)
}

/**
 * Checks the limit and, when the request is blocked, records a
 * `security.rate_limited` audit event. Never throws on its own — callers
 * decide how to translate a blocked result into an `AppError`.
 */
export async function enforceRateLimit(
  policy: CheckRateLimitInput,
  request: AuditRequestContext,
  tenantId?: string | null,
): Promise<RateLimitResult> {
  const result = await checkRateLimit(policy)
  if (!result.allowed) {
    await recordAudit(null, request, {
      action: 'security.rate_limited',
      entityType: 'rate_limit',
      entityLabel: policy.key,
      tenantId: tenantId ?? null,
      metadata: { limit: policy.limit, windowSeconds: policy.windowSeconds },
    })
  }
  return result
}

/* ── Named policies ──────────────────────────────────────────────────────── */

/**
 * Every place in the app that needs a limiter reaches for one of these rather
 * than inventing a bucket key inline, so the limits are readable in one place.
 */
export const rateLimitPolicies = {
  loginByEmail: (emailNormalized: string): CheckRateLimitInput => ({
    key: `login:email:${emailNormalized}`,
    limit: 8,
    windowSeconds: 15 * 60,
  }),
  loginByIp: (ipAddress: string): CheckRateLimitInput => ({
    key: `login:ip:${ipAddress}`,
    limit: 30,
    windowSeconds: 15 * 60,
  }),
  passwordResetRequest: (emailNormalized: string): CheckRateLimitInput => ({
    key: `password-reset:request:${emailNormalized}`,
    limit: 5,
    windowSeconds: 60 * 60,
  }),
  passwordResetConsume: (tokenHash: string): CheckRateLimitInput => ({
    key: `password-reset:consume:${tokenHash}`,
    limit: 10,
    windowSeconds: 60 * 60,
  }),
  emailVerificationResend: (emailNormalized: string): CheckRateLimitInput => ({
    key: `verify-email:resend:${emailNormalized}`,
    limit: 5,
    windowSeconds: 60 * 60,
  }),
  invitationAcceptance: (tokenHash: string): CheckRateLimitInput => ({
    key: `invitation:accept:${tokenHash}`,
    limit: 10,
    windowSeconds: 60 * 60,
  }),
  publicFormSubmission: (ipAddress: string): CheckRateLimitInput => ({
    key: `public-form:${ipAddress}`,
    limit: serverEnv().PUBLIC_FORM_RATE_LIMIT_PER_HOUR,
    windowSeconds: 60 * 60,
  }),
  signatureLinkAccess: (tokenHash: string): CheckRateLimitInput => ({
    key: `signature-link:${tokenHash}`,
    limit: 30,
    windowSeconds: 60 * 60,
  }),
  exportGeneration: (userId: string): CheckRateLimitInput => ({
    key: `export:${userId}`,
    limit: 20,
    windowSeconds: 60 * 60,
  }),
  signupProvisioning: (ipAddress: string): CheckRateLimitInput => ({
    key: `signup:${ipAddress}`,
    limit: 5,
    windowSeconds: 60 * 60,
  }),
  mfaChallenge: (userId: string): CheckRateLimitInput => ({
    key: `mfa:challenge:${userId}`,
    limit: 10,
    windowSeconds: 15 * 60,
  }),
} as const
