import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { impersonationSessions, userTenantMemberships, users } from '@/db/schema'
import { getRequestMeta, requireActor } from '@/server/context'
import { recordAudit } from '@/lib/audit'
import { authorize, type Actor } from '@/lib/permissions'
import { AppError, forbidden, notFound } from '@/lib/errors'

/**
 * Support-session impersonation.
 *
 * Two entry points into another user's authority:
 *  - `tenant:impersonate` — an Admin stepping into one of their own tenant's
 *    users. `actor.tenantId` already equals the target tenant.
 *  - `platform:impersonate` — a platform Super Admin. Because that reaches
 *    across tenant boundaries, it additionally requires the Super Admin to
 *    have explicitly opened support access for that tenant first
 *    (`platform:tenant:support_access`), recorded as its own `tenant.accessed`
 *    audit event — a Super Admin's authority does not implicitly include
 *    "read/act inside any tenant" without that extra, logged step.
 *
 * An impersonation session is bound to the session row that started it and
 * hard-expires after 60 minutes; there is no renewal.
 */

export const IMPERSONATION_DURATION_MINUTES = 60
export const MIN_REASON_LENGTH = 10

export interface StartImpersonationInput {
  targetUserId: string
  tenantId: string
  reason: string
}

/**
 * Explicit step a platform Super Admin must take before acting inside a
 * tenant they do not belong to. Audited independently of any impersonation
 * that may follow, so "I looked" is always distinguishable from "I acted as".
 */
export async function openTenantSupportAccess(tenantId: string, reason: string): Promise<void> {
  const actor = await requireActor()
  const request = await getRequestMeta()

  if (reason.trim().length < MIN_REASON_LENGTH) {
    throw new AppError('validation_failed', 'validation.minLength', { params: { min: MIN_REASON_LENGTH } })
  }

  authorize(actor, 'platform:tenant:support_access', { tenantId })

  await recordAudit(actor, request, {
    action: 'tenant.accessed',
    entityType: 'tenant',
    entityId: tenantId,
    reason,
    tenantId,
  })
}

export async function startImpersonation(input: StartImpersonationInput): Promise<{ impersonationSessionId: string }> {
  const actor = await requireActor()
  const request = await getRequestMeta()

  if (input.reason.trim().length < MIN_REASON_LENGTH) {
    throw new AppError('validation_failed', 'validation.minLength', { params: { min: MIN_REASON_LENGTH } })
  }
  if (!actor.sessionId) throw forbidden()
  if (input.targetUserId === actor.userId) throw forbidden('errors.forbidden')

  const isOwnTenant = actor.tenantId === input.tenantId
  const permission = isOwnTenant ? ('tenant:impersonate' as const) : ('platform:impersonate' as const)
  authorize(actor, permission, { tenantId: input.tenantId })

  // A cross-tenant Super Admin must open support access first, as its own
  // logged step, immediately before the impersonation itself begins.
  if (!isOwnTenant) {
    await openTenantSupportAccess(input.tenantId, input.reason)
  }

  const membership = await unsafeDb
    .select({ id: userTenantMemberships.id })
    .from(userTenantMemberships)
    .where(
      and(
        eq(userTenantMemberships.tenantId, input.tenantId),
        eq(userTenantMemberships.userId, input.targetUserId),
        eq(userTenantMemberships.status, 'active'),
        isNull(userTenantMemberships.deletedAt),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!membership) throw notFound('errors.notFound')

  const targetUser = await unsafeDb
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(eq(users.id, input.targetUserId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!targetUser) throw notFound('errors.notFound')

  const expiresAt = new Date(Date.now() + IMPERSONATION_DURATION_MINUTES * 60_000)

  const [row] = await unsafeDb
    .insert(impersonationSessions)
    .values({
      actorUserId: actor.userId,
      targetUserId: input.targetUserId,
      tenantId: input.tenantId,
      reason: input.reason,
      sessionId: actor.sessionId,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      expiresAt,
    })
    .returning()

  await recordAudit(actor, request, {
    action: 'impersonation.started',
    entityType: 'user',
    entityId: input.targetUserId,
    entityLabel: `${targetUser.firstName} ${targetUser.lastName}`,
    reason: input.reason,
    tenantId: input.tenantId,
    metadata: { expiresAt: expiresAt.toISOString() },
  })

  return { impersonationSessionId: row!.id }
}

export async function endImpersonation(): Promise<void> {
  const actor = await requireActor()
  const request = await getRequestMeta()

  if (!actor.impersonation) {
    throw new AppError('conflict', 'errors.conflict')
  }

  await unsafeDb
    .update(impersonationSessions)
    .set({ endedAt: new Date() })
    .where(eq(impersonationSessions.id, actor.impersonation.impersonationSessionId))

  await recordAudit(actor, request, {
    action: 'impersonation.ended',
    entityType: 'user',
    entityId: actor.userId,
    tenantId: actor.tenantId,
  })
}

export function describeImpersonationTarget(actor: Actor): { actorUserId: string; targetUserId: string } | null {
  if (!actor.impersonation) return null
  return { actorUserId: actor.impersonation.actorUserId, targetUserId: actor.userId }
}
