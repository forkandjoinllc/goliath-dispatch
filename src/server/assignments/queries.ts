import 'server-only'
import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { TenantDb } from '@/db/tenant-db'
import {
  carrierDispatcherAssignments,
  carriers,
  dispatcherGroups,
  dispatcherResourceAssignments,
  driverCarrierRelationships,
  groupMembers,
  userTenantMemberships,
  users,
  type CarrierDispatcherAssignment,
  type DispatcherGroup,
} from '@/db/schema'
import { fullName } from '@/lib/utils'
import type { AssignmentScope } from '@/lib/permissions'
import { activeGrantWindow, type DispatcherResourceAssignment } from './service'

/**
 * Read models for the assignment domain: the dispatcher × carrier matrix, a
 * dispatcher's full reach, and a carrier's assignment history.
 *
 * `dispatcherReach` deliberately re-derives the same shape
 * `server/context.ts::loadDispatcherAssignments` computes for authorization
 * — that function is private to a module this agent does not own, and this
 * one serves a different caller (an Admin auditing what a dispatcher can
 * see), so a second, explicitly-commented implementation is clearer than
 * reaching into another module's internals.
 */

function notEnded(endDateColumn: PgColumn) {
  const now = new Date()
  return or(isNull(endDateColumn), gt(endDateColumn, now))!
}

export interface DispatcherUserOption {
  userId: string
  name: string
}

/** Every active dispatcher in the tenant — options for the "grant access" and matrix screens. */
export async function listDispatcherUsers(db: TenantDb): Promise<DispatcherUserOption[]> {
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
  return rows.map((u) => ({ userId: u.id, name: fullName(u) })).sort((a, b) => a.name.localeCompare(b.name))
}

/* ── Matrix ──────────────────────────────────────────────────────────────── */

export interface DispatcherCarrierMatrixRow {
  dispatcherUserId: string
  dispatcherName: string
  carriers: Array<{ carrierId: string; legalName: string; isPrimary: boolean }>
}

/** Every dispatcher in the tenant, each with the carriers they are currently assigned to and which one is primary. */
export async function dispatcherCarrierMatrix(db: TenantDb): Promise<DispatcherCarrierMatrixRow[]> {
  const activeAssignments = await db.findMany(carrierDispatcherAssignments, {
    where: isNull(carrierDispatcherAssignments.endDate),
    orderBy: desc(carrierDispatcherAssignments.startDate),
  })
  if (activeAssignments.length === 0) return []

  const dispatcherUserIds = [...new Set(activeAssignments.map((a) => a.dispatcherUserId))]
  const carrierIds = [...new Set(activeAssignments.map((a) => a.carrierId))]

  const [dispatcherUsers, relatedCarriers] = await Promise.all([
    db.builderRequiringExplicitTenantPredicate
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .innerJoin(
        userTenantMemberships,
        and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, db.tenantId)),
      )
      .where(inArray(users.id, dispatcherUserIds)),
    db.findMany(carriers, { where: inArray(carriers.id, carrierIds) }),
  ])

  const dispatcherNameById = new Map(dispatcherUsers.map((u) => [u.id, fullName(u)]))
  const carrierById = new Map(relatedCarriers.map((c) => [c.id, c]))

  const byDispatcher = new Map<string, DispatcherCarrierMatrixRow>()
  for (const assignment of activeAssignments) {
    const carrier = carrierById.get(assignment.carrierId)
    if (!carrier) continue
    const row = byDispatcher.get(assignment.dispatcherUserId) ?? {
      dispatcherUserId: assignment.dispatcherUserId,
      dispatcherName: dispatcherNameById.get(assignment.dispatcherUserId) ?? assignment.dispatcherUserId,
      carriers: [],
    }
    row.carriers.push({ carrierId: carrier.id, legalName: carrier.legalName, isPrimary: assignment.isPrimary })
    byDispatcher.set(assignment.dispatcherUserId, row)
  }

  return [...byDispatcher.values()]
}

/* ── A dispatcher's full reach ───────────────────────────────────────────── */

/** Same shape as `Actor.assignments` — see `server/context.ts::loadDispatcherAssignments` for the authorization-time equivalent. */
export async function dispatcherReach(db: TenantDb, dispatcherUserId: string): Promise<AssignmentScope> {
  const [carrierRows, resourceRows, ownedGroups] = await Promise.all([
    db.findMany(carrierDispatcherAssignments, {
      where: and(eq(carrierDispatcherAssignments.dispatcherUserId, dispatcherUserId), isNull(carrierDispatcherAssignments.endDate))!,
    }),
    db.findMany(dispatcherResourceAssignments, {
      where: and(eq(dispatcherResourceAssignments.dispatcherUserId, dispatcherUserId), notEnded(dispatcherResourceAssignments.endDate))!,
    }),
    db.findMany(dispatcherGroups, {
      where: and(eq(dispatcherGroups.ownerDispatcherUserId, dispatcherUserId), eq(dispatcherGroups.active, true))!,
    }),
  ])

  const scope: AssignmentScope = {
    carrierIds: carrierRows.map((r) => r.carrierId),
    truckIds: [],
    trailerIds: [],
    driverIds: [],
    groupIds: ownedGroups.map((g) => g.id),
  }

  for (const row of resourceRows) {
    if (row.resourceType === 'truck') scope.truckIds.push(row.resourceId)
    else if (row.resourceType === 'trailer') scope.trailerIds.push(row.resourceId)
    else if (row.resourceType === 'driver') scope.driverIds.push(row.resourceId)
    else if (row.resourceType === 'group') scope.groupIds.push(row.resourceId)
  }

  if (scope.groupIds.length > 0) {
    const memberRows = await db.findMany(groupMembers, { where: inArray(groupMembers.groupId, scope.groupIds) })
    for (const m of memberRows) {
      if (m.memberType === 'carrier') scope.carrierIds.push(m.memberId)
      else if (m.memberType === 'truck') scope.truckIds.push(m.memberId)
      else if (m.memberType === 'trailer') scope.trailerIds.push(m.memberId)
      else if (m.memberType === 'driver') scope.driverIds.push(m.memberId)
    }
  }

  if (scope.carrierIds.length > 0) {
    const relatedDrivers = await db.findMany(driverCarrierRelationships, {
      where: and(inArray(driverCarrierRelationships.carrierId, scope.carrierIds), notEnded(driverCarrierRelationships.endDate))!,
    })
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

/** Every direct resource grant a dispatcher currently holds (excludes group-derived reach) — the raw rows behind `dispatcherReach`. */
export async function listDispatcherResourceGrants(
  db: TenantDb,
  dispatcherUserId: string,
): Promise<DispatcherResourceAssignment[]> {
  return db.findMany(dispatcherResourceAssignments, {
    where: and(eq(dispatcherResourceAssignments.dispatcherUserId, dispatcherUserId), activeGrantWindow())!,
    orderBy: desc(dispatcherResourceAssignments.startDate),
  })
}

/* ── Carrier assignment history ──────────────────────────────────────────── */

export interface CarrierAssignmentHistoryRow {
  assignment: CarrierDispatcherAssignment
  dispatcherName: string
}

/** Every assignment a carrier has ever had, including ended ones — the full history the architecture requires. */
export async function assignmentHistoryForCarrier(db: TenantDb, carrierId: string): Promise<CarrierAssignmentHistoryRow[]> {
  const rows = await db.findMany(carrierDispatcherAssignments, {
    where: eq(carrierDispatcherAssignments.carrierId, carrierId),
    orderBy: desc(carrierDispatcherAssignments.startDate),
    includeDeleted: true,
  })
  if (rows.length === 0) return []

  const dispatcherUserIds = [...new Set(rows.map((r) => r.dispatcherUserId))]
  const dispatcherUsers = await db.builderRequiringExplicitTenantPredicate
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .innerJoin(
      userTenantMemberships,
      and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, db.tenantId)),
    )
    .where(inArray(users.id, dispatcherUserIds))
  const nameById = new Map(dispatcherUsers.map((u) => [u.id, fullName(u)]))

  return rows.map((assignment) => ({
    assignment,
    dispatcherName: nameById.get(assignment.dispatcherUserId) ?? assignment.dispatcherUserId,
  }))
}

export async function listGroups(db: TenantDb, includeInactive = false): Promise<DispatcherGroup[]> {
  return db.findMany(dispatcherGroups, {
    where: includeInactive ? undefined : eq(dispatcherGroups.active, true),
    orderBy: desc(dispatcherGroups.createdAt),
  })
}

export interface DispatcherGroupView {
  group: DispatcherGroup
  ownerName: string | null
  memberCount: number
}

/** `listGroups` plus the owner's display name and member count, for the Groups tab. */
export async function listGroupsWithDetail(db: TenantDb, includeInactive = false): Promise<DispatcherGroupView[]> {
  const groups = await listGroups(db, includeInactive)
  if (groups.length === 0) return []

  const ownerIds = [...new Set(groups.map((g) => g.ownerDispatcherUserId).filter((id): id is string => id != null))]
  const [owners, memberRows] = await Promise.all([
    ownerIds.length > 0
      ? db.builderRequiringExplicitTenantPredicate
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .innerJoin(
            userTenantMemberships,
            and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, db.tenantId)),
          )
          .where(inArray(users.id, ownerIds))
      : Promise.resolve([]),
    db.findMany(groupMembers, { where: inArray(groupMembers.groupId, groups.map((g) => g.id)) }),
  ])
  const ownerNameById = new Map(owners.map((u) => [u.id, fullName(u)]))
  const memberCountByGroup = new Map<string, number>()
  for (const member of memberRows) {
    memberCountByGroup.set(member.groupId, (memberCountByGroup.get(member.groupId) ?? 0) + 1)
  }

  return groups.map((group) => ({
    group,
    ownerName: group.ownerDispatcherUserId ? ownerNameById.get(group.ownerDispatcherUserId) ?? null : null,
    memberCount: memberCountByGroup.get(group.id) ?? 0,
  }))
}
