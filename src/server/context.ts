import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { unsafeDb } from '@/db/client'
import {
  carrierDispatcherAssignments,
  dispatcherResourceAssignments,
  driverCarrierRelationships,
  groupMembers,
  dispatcherGroups,
  impersonationSessions,
  mfaConfigurations,
  permissions as permissionsTable,
  tenantSettings,
  tenants,
  userPermissionOverrides,
  userTenantMemberships,
} from '@/db/schema'
import { readSessionToken, resolveSession } from '@/lib/auth/session'
import type { Actor, AssignmentScope, Role, Scope } from '@/lib/permissions'
import { unauthenticated } from '@/lib/errors'
import { newId } from '@/lib/crypto'

/**
 * Request context.
 *
 * `getActor()` is memoized per request by React `cache`, so a page that renders
 * twenty permission-aware components performs one authorization load, not
 * twenty. Everything downstream — data access, server actions, audit — takes the
 * Actor as its authority; nothing re-derives permissions from role strings.
 */

export interface RequestMeta {
  ipAddress: string | null
  userAgent: string | null
  requestId: string
}

export const getRequestMeta = cache(async (): Promise<RequestMeta> => {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  return {
    ipAddress: forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
    userAgent: h.get('user-agent'),
    requestId: h.get('x-request-id') ?? newId(),
  }
})

const MFA_REQUIRED_ROLES: Role[] = ['admin', 'accounting']

export const getActor = cache(async (): Promise<Actor | null> => {
  const token = await readSessionToken()
  const resolved = await resolveSession(token)
  if (!resolved) return null

  const { session, user } = resolved

  // An active impersonation session redirects authority to the target user
  // while keeping the initiating account recorded as the actor.
  const impersonation = await unsafeDb
    .select()
    .from(impersonationSessions)
    .where(
      and(
        eq(impersonationSessions.sessionId, session.id),
        isNull(impersonationSessions.endedAt),
        gt(impersonationSessions.expiresAt, new Date()),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  const effectiveUserId = impersonation?.targetUserId ?? user.id
  const tenantId = impersonation?.tenantId ?? session.activeTenantId

  let membership = null as typeof userTenantMemberships.$inferSelect | null
  if (tenantId) {
    membership = await unsafeDb
      .select()
      .from(userTenantMemberships)
      .where(
        and(
          eq(userTenantMemberships.userId, effectiveUserId),
          eq(userTenantMemberships.tenantId, tenantId),
          eq(userTenantMemberships.status, 'active'),
          isNull(userTenantMemberships.deletedAt),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
  }

  const role: Role | null = membership?.role ?? (user.isPlatformSuperAdmin ? 'platform_super_admin' : null)

  const assignments =
    role === 'dispatcher' && tenantId
      ? await loadDispatcherAssignments(tenantId, effectiveUserId)
      : emptyAssignments()

  const overrides = tenantId ? await loadOverrides(tenantId, effectiveUserId) : []

  const mfaRequired = role != null && MFA_REQUIRED_ROLES.includes(role)
  const mfaEnrolled = await unsafeDb
    .select({ id: mfaConfigurations.id })
    .from(mfaConfigurations)
    .where(
      and(
        eq(mfaConfigurations.userId, effectiveUserId),
        isNull(mfaConfigurations.deletedAt),
      ),
    )
    .limit(1)
    .then((rows) => rows.length > 0)

  return {
    userId: effectiveUserId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    locale: user.locale,
    timezone: user.timezone,
    isPlatformSuperAdmin: user.isPlatformSuperAdmin && !impersonation,
    tenantId,
    role,
    carrierId: membership?.carrierId ?? null,
    driverId: membership?.driverId ?? null,
    assignments,
    overrides,
    // An enrolled user must complete the challenge; an un-enrolled user in a
    // required role is routed to setup by the app shell rather than blocked here.
    mfaRequired: mfaRequired && mfaEnrolled,
    mfaSatisfied: session.mfaSatisfiedAt != null,
    impersonation: impersonation
      ? {
          actorUserId: impersonation.actorUserId,
          impersonationSessionId: impersonation.id,
          reason: impersonation.reason,
        }
      : null,
    sessionId: session.id,
  }
})

export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) throw unauthenticated()
  return actor
}

export async function requireTenantActor(): Promise<Actor & { tenantId: string; role: Role }> {
  const actor = await requireActor()
  if (!actor.tenantId || !actor.role) throw unauthenticated('errors.forbidden')
  return actor as Actor & { tenantId: string; role: Role }
}

/** Tenant policy that widens or narrows the role matrix (see catalog.ts). */
export const getTenantPolicy = cache(async (tenantId: string) => {
  const settings = await unsafeDb
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return {
    allowDispatcherResourceAssignment: settings?.allowDispatcherResourceAssignment ?? false,
    documentExpirationWarningDays: settings?.documentExpirationWarningDays ?? 30,
    dispatcherCommissionBasis: settings?.dispatcherCommissionBasis ?? 'dispatch_fee_amount',
    timezone: settings?.addressState ? undefined : undefined,
    settings,
  }
})

export const getTenant = cache(async (tenantId: string) => {
  return unsafeDb
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
})

/* ── Assignment resolution ───────────────────────────────────────────────── */

function emptyAssignments(): AssignmentScope {
  return { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] }
}

/**
 * A dispatcher's reach is the union of:
 *  • carriers they are assigned to,
 *  • resources granted to them directly,
 *  • resources inside groups they own.
 */
async function loadDispatcherAssignments(
  tenantId: string,
  dispatcherUserId: string,
): Promise<AssignmentScope> {
  const notEnded = (col: PgColumn) => or(isNull(col), gt(col, new Date()))!

  const [carrierRows, resourceRows, groupRows] = await Promise.all([
    unsafeDb
      .select({ carrierId: carrierDispatcherAssignments.carrierId })
      .from(carrierDispatcherAssignments)
      .where(
        and(
          eq(carrierDispatcherAssignments.tenantId, tenantId),
          eq(carrierDispatcherAssignments.dispatcherUserId, dispatcherUserId),
          isNull(carrierDispatcherAssignments.deletedAt),
          notEnded(carrierDispatcherAssignments.endDate),
        ),
      ),
    unsafeDb
      .select({
        resourceType: dispatcherResourceAssignments.resourceType,
        resourceId: dispatcherResourceAssignments.resourceId,
      })
      .from(dispatcherResourceAssignments)
      .where(
        and(
          eq(dispatcherResourceAssignments.tenantId, tenantId),
          eq(dispatcherResourceAssignments.dispatcherUserId, dispatcherUserId),
          isNull(dispatcherResourceAssignments.deletedAt),
          notEnded(dispatcherResourceAssignments.endDate),
        ),
      ),
    unsafeDb
      .select({ id: dispatcherGroups.id })
      .from(dispatcherGroups)
      .where(
        and(
          eq(dispatcherGroups.tenantId, tenantId),
          eq(dispatcherGroups.ownerDispatcherUserId, dispatcherUserId),
          eq(dispatcherGroups.active, true),
          isNull(dispatcherGroups.deletedAt),
        ),
      ),
  ])

  const scope = emptyAssignments()
  scope.carrierIds = carrierRows.map((r) => r.carrierId)
  scope.groupIds = groupRows.map((r) => r.id)

  for (const row of resourceRows) {
    if (row.resourceType === 'truck') scope.truckIds.push(row.resourceId)
    else if (row.resourceType === 'trailer') scope.trailerIds.push(row.resourceId)
    else if (row.resourceType === 'driver') scope.driverIds.push(row.resourceId)
    else if (row.resourceType === 'group') scope.groupIds.push(row.resourceId)
  }

  // Expand owned/granted groups into their members.
  if (scope.groupIds.length > 0) {
    const owned = new Set(scope.groupIds)
    const memberRows = await unsafeDb
      .select({
        groupId: groupMembers.groupId,
        memberType: groupMembers.memberType,
        memberId: groupMembers.memberId,
      })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.tenantId, tenantId),
          inArray(groupMembers.groupId, [...owned]),
          isNull(groupMembers.deletedAt),
        ),
      )

    for (const m of memberRows) {
      if (m.memberType === 'carrier') scope.carrierIds.push(m.memberId)
      else if (m.memberType === 'truck') scope.truckIds.push(m.memberId)
      else if (m.memberType === 'trailer') scope.trailerIds.push(m.memberId)
      else if (m.memberType === 'driver') scope.driverIds.push(m.memberId)
    }
  }

  // Drivers running for an assigned carrier are visible to that dispatcher.
  if (scope.carrierIds.length > 0) {
    const relatedDrivers = await unsafeDb
      .select({ driverId: driverCarrierRelationships.driverId })
      .from(driverCarrierRelationships)
      .where(
        and(
          eq(driverCarrierRelationships.tenantId, tenantId),
          inArray(driverCarrierRelationships.carrierId, scope.carrierIds),
          isNull(driverCarrierRelationships.deletedAt),
          or(
            isNull(driverCarrierRelationships.endDate),
            gt(driverCarrierRelationships.endDate, new Date()),
          )!,
        ),
      )
    scope.driverIds.push(...relatedDrivers.map((r) => r.driverId))
  }

  return {
    carrierIds: [...new Set(scope.carrierIds)],
    truckIds: [...new Set(scope.truckIds)],
    trailerIds: [...new Set(scope.trailerIds)],
    driverIds: [...new Set(scope.driverIds)],
    groupIds: [...new Set(scope.groupIds)],
  }
}

async function loadOverrides(tenantId: string, userId: string) {
  const rows = await unsafeDb
    .select({
      key: permissionsTable.key,
      effect: userPermissionOverrides.effect,
      scope: userPermissionOverrides.scope,
      expiresAt: userPermissionOverrides.expiresAt,
    })
    .from(userPermissionOverrides)
    .innerJoin(permissionsTable, eq(permissionsTable.id, userPermissionOverrides.permissionId))
    .where(
      and(
        eq(userPermissionOverrides.tenantId, tenantId),
        eq(userPermissionOverrides.userId, userId),
        isNull(userPermissionOverrides.deletedAt),
      ),
    )

  const now = Date.now()
  return rows
    .filter((r) => !r.expiresAt || r.expiresAt.getTime() > now)
    .map((r) => ({
      permissionKey: r.key,
      effect: r.effect as 'grant' | 'deny',
      scope: r.scope as Scope,
    }))
}
