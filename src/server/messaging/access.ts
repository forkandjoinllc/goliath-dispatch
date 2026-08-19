import 'server-only'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { carrierDispatcherAssignments, userTenantMemberships, users } from '@/db/schema'
import { can } from '@/lib/permissions'
import type { Actor, AssignmentScope, PermissionKey, ResourceContext, Role } from '@/lib/permissions'
import { forbidden } from '@/lib/errors'

/**
 * Shared scope-checking for the messaging domain.
 *
 * A conversation's participant list is the one place messaging enforces
 * "may this user see the subject" — every add-participant call and every
 * conversation-creation call resolves each candidate's real role/assignment
 * facts and runs them through the exact same `can()`/`resourceInScope` the
 * rest of the application uses, rather than inventing a bespoke messaging
 * permission model.
 */

function emptyAssignments(): AssignmentScope {
  return { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] }
}

function pseudoActor(fact: MembershipFacts, tenantId: string): Actor {
  return {
    userId: fact.userId,
    email: '',
    firstName: '',
    lastName: '',
    locale: 'en',
    timezone: 'UTC',
    isPlatformSuperAdmin: false,
    tenantId,
    role: fact.role,
    carrierId: fact.carrierId,
    driverId: fact.driverId,
    assignments: fact.assignments,
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: null,
  }
}

export interface MembershipFacts {
  userId: string
  role: Role | null
  carrierId: string | null
  driverId: string | null
  assignments: AssignmentScope
}

/** Role/assignment facts for exactly the given users — the messaging-sized version of `context.ts`'s assignment loader. */
export async function loadMembershipFacts(db: TenantDb, userIds: string[]): Promise<Map<string, MembershipFacts>> {
  if (userIds.length === 0) return new Map()

  const memberships = await db.builderRequiringExplicitTenantPredicate
    .select({
      userId: userTenantMemberships.userId,
      role: userTenantMemberships.role,
      carrierId: userTenantMemberships.carrierId,
      driverId: userTenantMemberships.driverId,
    })
    .from(userTenantMemberships)
    .where(
      and(
        eq(userTenantMemberships.tenantId, db.tenantId),
        inArray(userTenantMemberships.userId, userIds),
        eq(userTenantMemberships.status, 'active'),
        isNull(userTenantMemberships.deletedAt),
      ),
    )

  const dispatcherIds = memberships.filter((m) => m.role === 'dispatcher').map((m) => m.userId)
  const assignmentsByUser = new Map<string, string[]>()
  if (dispatcherIds.length > 0) {
    const assignments = await db.findMany(carrierDispatcherAssignments, {
      where: and(
        inArray(carrierDispatcherAssignments.dispatcherUserId, dispatcherIds),
        isNull(carrierDispatcherAssignments.endDate),
      )!,
    })
    for (const assignment of assignments) {
      const list = assignmentsByUser.get(assignment.dispatcherUserId) ?? []
      list.push(assignment.carrierId)
      assignmentsByUser.set(assignment.dispatcherUserId, list)
    }
  }

  return new Map(
    memberships.map((m) => [
      m.userId,
      {
        userId: m.userId,
        role: m.role as Role,
        carrierId: m.carrierId,
        driverId: m.driverId,
        assignments: { ...emptyAssignments(), carrierIds: assignmentsByUser.get(m.userId) ?? [] },
      },
    ]),
  )
}

/**
 * Throws unless every one of `userIds` may hold `permission` against
 * `resource` — the check `createConversation`/`addParticipant` run before
 * ever writing a `conversationParticipants` row. A user with no active
 * membership at all (facts missing from the map) always fails.
 */
export async function assertUsersCanAccessSubject(
  db: TenantDb,
  userIds: string[],
  permission: PermissionKey,
  resource: ResourceContext,
): Promise<void> {
  const facts = await loadMembershipFacts(db, userIds)
  for (const userId of userIds) {
    const fact = facts.get(userId)
    const allowed = fact ? can(pseudoActor(fact, db.tenantId), permission, resource).allowed : false
    if (!allowed) {
      throw forbidden('errors.outOfScope', { permission, userId })
    }
  }
}

/** Basic existence + active-membership check, for participants who don't need a scope check (e.g. the creator). */
export async function requireActiveMember(db: TenantDb, userId: string): Promise<void> {
  const exists = await db.builderRequiringExplicitTenantPredicate
    .select({ userId: userTenantMemberships.userId })
    .from(userTenantMemberships)
    .innerJoin(users, eq(users.id, userTenantMemberships.userId))
    .where(
      and(
        eq(userTenantMemberships.tenantId, db.tenantId),
        eq(userTenantMemberships.userId, userId),
        eq(userTenantMemberships.status, 'active'),
        isNull(userTenantMemberships.deletedAt),
      ),
    )
    .limit(1)
  if (exists.length === 0) throw forbidden('errors.outOfScope', { userId })
}
