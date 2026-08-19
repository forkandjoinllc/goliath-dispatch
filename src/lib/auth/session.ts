import 'server-only'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { unsafeDb } from '@/db/client'
import { sessions, users } from '@/db/schema'
import { generateToken, hashToken } from '@/lib/crypto'

/**
 * Opaque, database-backed sessions.
 *
 * A JWT would avoid a lookup, but this product needs immediate revocation
 * (Admin suspends a user, a support session ends, a device is lost) and an
 * auditable list of active devices. The raw token exists only in the cookie;
 * the database stores its SHA-256.
 */

export const SESSION_COOKIE = 'goliath_session'
export const SESSION_TTL_HOURS = 12
export const SESSION_REMEMBER_TTL_DAYS = 30

export interface CreateSessionInput {
  userId: string
  activeTenantId: string | null
  ipAddress: string | null
  userAgent: string | null
  remember?: boolean
  mfaSatisfied?: boolean
}

export async function createSession(input: CreateSessionInput) {
  const token = generateToken(32)
  const expiresAt = new Date(
    Date.now() +
      (input.remember
        ? SESSION_REMEMBER_TTL_DAYS * 24 * 60 * 60 * 1000
        : SESSION_TTL_HOURS * 60 * 60 * 1000),
  )

  const [session] = await unsafeDb
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: hashToken(token),
      activeTenantId: input.activeTenantId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      mfaSatisfiedAt: input.mfaSatisfied ? new Date() : null,
      expiresAt,
    })
    .returning()

  return { token, session: session! }
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export async function clearSessionCookie() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value ?? null
}

/** Resolves the cookie to a live session + user, or null. Touches lastSeenAt. */
export async function resolveSession(token: string | null) {
  if (!token) return null

  const rows = await unsafeDb
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        isNull(users.deletedAt),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.user.status === 'suspended' || row.user.status === 'deactivated') return null

  // Throttled write: only touch once a minute to avoid a write per request.
  const lastSeen = row.session.lastSeenAt?.getTime() ?? 0
  if (Date.now() - lastSeen > 60_000) {
    await unsafeDb
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.session.id))
  }

  return row
}

export async function markMfaSatisfied(sessionId: string) {
  await unsafeDb.update(sessions).set({ mfaSatisfiedAt: new Date() }).where(eq(sessions.id, sessionId))
}

export async function switchActiveTenant(sessionId: string, tenantId: string) {
  await unsafeDb.update(sessions).set({ activeTenantId: tenantId }).where(eq(sessions.id, sessionId))
}

export async function revokeSession(sessionId: string, reason: string) {
  await unsafeDb
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(eq(sessions.id, sessionId))
}

/** Used on password change, suspension and "sign out everywhere". */
export async function revokeAllUserSessions(userId: string, reason: string, exceptSessionId?: string) {
  const rows = await unsafeDb
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id })

  if (exceptSessionId) {
    await unsafeDb
      .update(sessions)
      .set({ revokedAt: null, revokedReason: null })
      .where(eq(sessions.id, exceptSessionId))
    return rows.filter((r) => r.id !== exceptSessionId).length
  }
  return rows.length
}
