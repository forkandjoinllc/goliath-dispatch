import 'server-only'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { dispatcherGroups, dispatcherResourceAssignments, type DispatcherGroup } from '@/db/schema'
import { AppError, notFound } from '@/lib/errors'

/** Not exported by `db/schema/carrier.ts` — inferred locally, same pattern as every other row type in this module. */
export type DispatcherResourceAssignment = typeof dispatcherResourceAssignments.$inferSelect

/**
 * Dispatcher resource grants and group lifecycle.
 *
 * Carrier↔dispatcher assignment (`carrierDispatcherAssignments`) and group
 * creation/membership (`dispatcherGroups`/`groupMembers`) already live in
 * `server/carriers/service.ts` (`assignDispatcher`, `setPrimaryDispatcher`,
 * `createGroup`, `addGroupMember`, `removeGroupMember`) — that module owns
 * the carrier record a dispatcher is being attached to, and duplicating that
 * logic here would give the product two places that could disagree about
 * "exactly one primary dispatcher per carrier". Screens under this agent's
 * `assignments/` route import those functions directly from
 * `@/server/carriers` alongside what this module adds:
 *
 *   • per-resource grants (`dispatcherResourceAssignments`) for individual
 *     trucks, trailers, drivers and groups — nothing else in the codebase
 *     writes this table (only `server/context.ts` reads it, to build a
 *     dispatcher's `AssignmentScope`);
 *   • renaming/deactivating a group (create/add/remove-member already exist
 *     in `carriers/service.ts`).
 *
 * `assignment:manage` is Admin-only in the role matrix — every mutation here
 * relies on that permission, never a role-name comparison (see `actions.ts`).
 */

function activeGrantWindow() {
  const now = new Date()
  return or(isNull(dispatcherResourceAssignments.endDate), gt(dispatcherResourceAssignments.endDate, now))!
}

export type DispatcherResourceType = 'truck' | 'trailer' | 'driver' | 'group'

export interface GrantDispatcherResourceInput {
  dispatcherUserId: string
  resourceType: DispatcherResourceType
  resourceId: string
  reason?: string | null
}

/**
 * Grants a dispatcher direct access to one truck/trailer/driver/group. A
 * dispatcher's actual reach also includes anything reachable through a
 * carrier assignment or a group they own — see
 * `server/context.ts::loadDispatcherAssignments` — so this is additive, not
 * exhaustive.
 *
 * A grant takes effect on the *next* request: `getActor()` is memoized per
 * request by React `cache`, so a page already rendering under the old
 * `AssignmentScope` does not see this write until it re-renders.
 */
export async function grantDispatcherResource(
  db: TenantDb,
  actor: { userId: string },
  input: GrantDispatcherResourceInput,
): Promise<DispatcherResourceAssignment> {
  const alreadyActive = await db.exists(
    dispatcherResourceAssignments,
    and(
      eq(dispatcherResourceAssignments.dispatcherUserId, input.dispatcherUserId),
      eq(dispatcherResourceAssignments.resourceType, input.resourceType),
      eq(dispatcherResourceAssignments.resourceId, input.resourceId),
      activeGrantWindow(),
    )!,
  )
  if (alreadyActive) {
    throw new AppError('conflict', 'assignment.errors.grantAlreadyActive')
  }

  return db.insert(dispatcherResourceAssignments, {
    dispatcherUserId: input.dispatcherUserId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    startDate: new Date(),
    assignedByUserId: actor.userId,
    reason: input.reason ?? null,
  })
}

export interface RevokeDispatcherResourceInput {
  dispatcherUserId: string
  resourceType: DispatcherResourceType
  resourceId: string
  reason?: string | null
}

/** Ends the active grant window; the row is retained as history, matching every other assignment table in this product. */
export async function revokeDispatcherResource(
  db: TenantDb,
  _actor: { userId: string },
  input: RevokeDispatcherResourceInput,
): Promise<DispatcherResourceAssignment[]> {
  const rows = await db.updateWhere(
    dispatcherResourceAssignments,
    and(
      eq(dispatcherResourceAssignments.dispatcherUserId, input.dispatcherUserId),
      eq(dispatcherResourceAssignments.resourceType, input.resourceType),
      eq(dispatcherResourceAssignments.resourceId, input.resourceId),
      isNull(dispatcherResourceAssignments.endDate),
    )!,
    { endDate: new Date(), reason: input.reason ?? null },
  )
  if (rows.length === 0) throw notFound('errors.notFound', { entity: 'dispatcherResourceAssignment' })
  return rows
}

/* ── Group lifecycle (rename / deactivate) ──────────────────────────────── */

export async function renameGroup(
  db: TenantDb,
  _actor: { userId: string },
  groupId: string,
  name: string,
): Promise<DispatcherGroup> {
  const updated = await db.update(dispatcherGroups, groupId, { name })
  if (!updated) throw notFound('errors.notFound', { entity: 'dispatcherGroup' })
  return updated
}

export async function setGroupActive(
  db: TenantDb,
  _actor: { userId: string },
  groupId: string,
  active: boolean,
): Promise<DispatcherGroup> {
  const updated = await db.update(dispatcherGroups, groupId, { active })
  if (!updated) throw notFound('errors.notFound', { entity: 'dispatcherGroup' })
  return updated
}

export { activeGrantWindow }
