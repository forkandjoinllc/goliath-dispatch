import 'server-only'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { sessions } from '@/db/schema'
import { revokeAllUserSessions, revokeSession } from '@/lib/auth/session'
import { forbidden, notFound } from '@/lib/errors'

/**
 * Self-service session management: "what is signed in as me" plus the
 * ability to end one device or every device but this one.
 */

export interface SessionSummary {
  id: string
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
  lastSeenAt: Date
  expiresAt: Date
  isCurrent: boolean
}

export async function listActiveSessions(userId: string, currentSessionId: string | null): Promise<SessionSummary[]> {
  const rows = await unsafeDb
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt))

  return rows.map((row) => ({
    id: row.id,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    isCurrent: row.id === currentSessionId,
  }))
}

/** Revokes exactly one of the caller's own sessions — never someone else's. */
export async function revokeOwnSession(userId: string, sessionId: string): Promise<void> {
  const [row] = await unsafeDb
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)

  if (!row) throw notFound('errors.notFound')
  if (row.userId !== userId) throw forbidden()

  await revokeSession(sessionId, 'user_revoked')
}

/** Signs out every other device, keeping the session that issued the request alive. */
export async function revokeOtherSessions(userId: string, currentSessionId: string): Promise<number> {
  return revokeAllUserSessions(userId, 'user_revoked_others', currentSessionId)
}
