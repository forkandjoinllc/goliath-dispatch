import 'server-only'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  carrierDispatcherAssignments,
  carrierOnboardingEvents,
  fmcsaVerifications,
  users,
  userTenantMemberships,
  type CarrierDispatcherAssignment,
  type FmcsaVerification,
} from '@/db/schema'
import { fullName } from '@/lib/utils'

// `@/db/schema` does not export a named type for `carrierOnboardingEvents`
// rows (only the table itself) — the local alias mirrors how
// `src/server/messaging/queries.ts` handles the same gap for its own tables.
type CarrierOnboardingEvent = typeof carrierOnboardingEvents.$inferSelect

/**
 * Page-level read helpers for the carrier UI.
 *
 * `src/server/carriers/**` is owned by another agent and intentionally not
 * modified here — these are small, additive queries the UI needs that the
 * owning module does not (yet) export: per-page dispatcher name lookups for
 * the list screen and the FMCSA verification ledger / onboarding event
 * timeline for the detail screen. Every query still goes through `TenantDb`,
 * so tenant scoping and soft-delete are enforced exactly as they would be
 * inside the server module itself.
 */

export interface PrimaryDispatcherInfo {
  carrierId: string
  dispatcherUserId: string
  dispatcherName: string
}

/** Primary (active) dispatcher assignment per carrier, for a page of carrier ids. */
export async function primaryDispatchersFor(
  db: TenantDb,
  carrierIds: string[],
): Promise<Map<string, PrimaryDispatcherInfo>> {
  if (carrierIds.length === 0) return new Map()

  const assignments = await db.findMany(carrierDispatcherAssignments, {
    where: and(
      inArray(carrierDispatcherAssignments.carrierId, carrierIds),
      eq(carrierDispatcherAssignments.isPrimary, true),
      isNull(carrierDispatcherAssignments.endDate),
    )!,
  })
  if (assignments.length === 0) return new Map()

  const dispatcherUserIds = [...new Set(assignments.map((a) => a.dispatcherUserId))]
  // `users` has no `tenant_id` column — the tenant predicate is proven via the
  // membership join, matching the pattern in `carriers/queries.ts::onboardingBoard`.
  const dispatcherUsers = await db.builderRequiringExplicitTenantPredicate
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .innerJoin(
      userTenantMemberships,
      and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, db.tenantId)),
    )
    .where(inArray(users.id, dispatcherUserIds))

  const nameById = new Map(dispatcherUsers.map((u) => [u.id, fullName(u)]))
  const result = new Map<string, PrimaryDispatcherInfo>()
  for (const assignment of assignments) {
    const name = nameById.get(assignment.dispatcherUserId)
    if (!name) continue
    result.set(assignment.carrierId, {
      carrierId: assignment.carrierId,
      dispatcherUserId: assignment.dispatcherUserId,
      dispatcherName: name,
    })
  }
  return result
}

/** Every FMCSA verification attempt for a carrier, newest first. */
export async function listFmcsaVerificationHistory(db: TenantDb, carrierId: string): Promise<FmcsaVerification[]> {
  return db.findMany(fmcsaVerifications, {
    where: eq(fmcsaVerifications.carrierId, carrierId),
    orderBy: desc(fmcsaVerifications.checkedAt),
  })
}

/** The onboarding status-change timeline for a carrier's onboarding record. */
export async function listCarrierOnboardingEvents(
  db: TenantDb,
  onboardingId: string,
): Promise<CarrierOnboardingEvent[]> {
  return db.findMany(carrierOnboardingEvents, {
    where: eq(carrierOnboardingEvents.onboardingId, onboardingId),
    orderBy: desc(carrierOnboardingEvents.createdAt),
  })
}

export interface DispatcherAssignments {
  active: CarrierDispatcherAssignment[]
  history: CarrierDispatcherAssignment[]
}

/** Every dispatcher assignment ever made for a carrier, split into active vs. ended. */
export async function listDispatcherAssignments(db: TenantDb, carrierId: string): Promise<DispatcherAssignments> {
  const rows = await db.findMany(carrierDispatcherAssignments, {
    where: eq(carrierDispatcherAssignments.carrierId, carrierId),
    orderBy: desc(carrierDispatcherAssignments.startDate),
  })
  return {
    active: rows.filter((r) => r.endDate === null),
    history: rows.filter((r) => r.endDate !== null),
  }
}

/** Active dispatchers in the tenant, for the "assign a dispatcher" picker. */
export async function listDispatcherCandidates(db: TenantDb): Promise<{ userId: string; name: string }[]> {
  const rows = await db.builderRequiringExplicitTenantPredicate
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .innerJoin(
      userTenantMemberships,
      and(
        eq(userTenantMemberships.userId, users.id),
        eq(userTenantMemberships.tenantId, db.tenantId),
        eq(userTenantMemberships.role, 'dispatcher'),
        eq(userTenantMemberships.status, 'active'),
      ),
    )
  return rows.map((u) => ({ userId: u.id, name: fullName(u) }))
}

/** Display names for a set of user ids (dispatchers, decision-makers, etc.), tenant-scoped. */
export async function userNamesFor(db: TenantDb, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)].filter(Boolean)
  if (ids.length === 0) return new Map()
  const rows = await db.builderRequiringExplicitTenantPredicate
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .innerJoin(
      userTenantMemberships,
      and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, db.tenantId)),
    )
    .where(inArray(users.id, ids))
  return new Map(rows.map((u) => [u.id, fullName(u)]))
}
