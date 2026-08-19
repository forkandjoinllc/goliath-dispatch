import 'server-only'
import { and, asc, desc, eq, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  auditEvents,
  documents,
  equipmentMedia,
  equipmentTypes,
  equipmentVerifications,
  loadAssignments,
  loads,
  trailers,
  trucks,
  type AuditEvent,
  type Document,
  type EquipmentMedia,
  type EquipmentType,
  type EquipmentVerification,
  type Load,
  type LoadAssignment,
  type Trailer,
  type Truck,
} from '@/db/schema'
import type { ScopeFilter } from '@/lib/permissions/check'
import type { Pagination } from '@/lib/validation'
import { evaluateEquipmentForLoad } from '@/server/compliance/service'
import {
  mergeComplianceResults,
  scheduleGate,
  toComplianceResult,
  type ComplianceResult,
} from '@/server/compliance'
import type { EquipmentType as EquipmentKind } from '@/server/verification'
import { missingRequiredAngles } from './service'

/**
 * Read models for trucks and trailers.
 *
 * `listEquipment` filters on the same scope facts `resourceInScope()` uses
 * (`carrierIds`/`truckIds`/`trailerIds` from `ScopeFilter`), so a dispatcher's
 * list can never even fetch a unit outside their assignments. Status,
 * verification-state and expiry filters read the denormalized columns on the
 * truck/trailer row itself rather than joining `equipmentVerifications`, so
 * the list stays index-backed even at fleet scale; the full gate evaluation
 * (`evaluateEquipmentForLoad`) is reserved for the detail view and the
 * per-load candidate queries below, where the extra round trip per row is
 * the point, not a cost to avoid.
 */

type EquipmentTable = typeof trucks | typeof trailers

function tableFor(equipmentType: EquipmentKind): EquipmentTable {
  return equipmentType === 'truck' ? trucks : trailers
}

function scopeClause(table: EquipmentTable, scope: ScopeFilter): SQL | 'empty' | undefined {
  switch (scope.kind) {
    case 'assigned': {
      const ids = table === trucks ? scope.truckIds : scope.trailerIds
      const clauses: SQL[] = []
      if (scope.carrierIds.length > 0) clauses.push(inArray(table.carrierId, scope.carrierIds))
      if (ids.length > 0) clauses.push(inArray(table.id, ids))
      if (clauses.length === 0) return 'empty'
      return or(...clauses)
    }
    case 'carrier':
      return scope.carrierId ? eq(table.carrierId, scope.carrierId) : 'empty'
    case 'own':
      return 'empty'
    case 'tenant':
    case 'platform':
    default:
      return undefined
  }
}

export interface ListEquipmentOptions {
  carrierId?: string
  equipmentTypeId?: string
  status?: Truck['status']
  verificationStatus?: EquipmentVerification['status']
  expiringRegistrationWithinDays?: number
  expiringInspectionWithinDays?: number
  search?: string
  pagination?: Pagination
}

export interface ListEquipmentResult<T> {
  rows: T[]
  total: number
}

function daysFromNow(days: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export async function listTrucks(
  db: TenantDb,
  scope: ScopeFilter,
  options: ListEquipmentOptions = {},
): Promise<ListEquipmentResult<Truck>> {
  const scoped = scopeClause(trucks, scope)
  if (scoped === 'empty') return { rows: [], total: 0 }

  const clauses: SQL[] = []
  if (scoped) clauses.push(scoped)
  if (options.carrierId) clauses.push(eq(trucks.carrierId, options.carrierId))
  if (options.equipmentTypeId) clauses.push(eq(trucks.equipmentTypeId, options.equipmentTypeId))
  if (options.status) clauses.push(eq(trucks.status, options.status))
  if (options.verificationStatus) clauses.push(eq(trucks.coiVerificationStatus, options.verificationStatus))
  if (options.expiringRegistrationWithinDays != null) {
    clauses.push(lte(trucks.registrationExpiresAt, daysFromNow(options.expiringRegistrationWithinDays)))
  }
  if (options.expiringInspectionWithinDays != null) {
    clauses.push(lte(trucks.nextInspectionDueAt, daysFromNow(options.expiringInspectionWithinDays)))
  }
  if (options.search) clauses.push(or(ilike(trucks.unitNumber, `%${options.search}%`), ilike(trucks.vin, `%${options.search}%`))!)

  const where = clauses.length > 0 ? and(...clauses) : undefined
  const pagination = options.pagination ?? { page: 1, pageSize: 25 }

  const [rows, total] = await Promise.all([
    db.findMany(trucks, {
      where,
      orderBy: desc(trucks.createdAt),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(trucks, where),
  ])

  return { rows, total }
}

export async function listTrailers(
  db: TenantDb,
  scope: ScopeFilter,
  options: ListEquipmentOptions = {},
): Promise<ListEquipmentResult<Trailer>> {
  const scoped = scopeClause(trailers, scope)
  if (scoped === 'empty') return { rows: [], total: 0 }

  const clauses: SQL[] = []
  if (scoped) clauses.push(scoped)
  if (options.carrierId) clauses.push(eq(trailers.carrierId, options.carrierId))
  if (options.equipmentTypeId) clauses.push(eq(trailers.equipmentTypeId, options.equipmentTypeId))
  if (options.status) clauses.push(eq(trailers.status, options.status))
  if (options.verificationStatus) clauses.push(eq(trailers.coiVerificationStatus, options.verificationStatus))
  if (options.expiringRegistrationWithinDays != null) {
    clauses.push(lte(trailers.registrationExpiresAt, daysFromNow(options.expiringRegistrationWithinDays)))
  }
  if (options.expiringInspectionWithinDays != null) {
    clauses.push(lte(trailers.nextInspectionDueAt, daysFromNow(options.expiringInspectionWithinDays)))
  }
  if (options.search) {
    clauses.push(or(ilike(trailers.unitNumber, `%${options.search}%`), ilike(trailers.vin, `%${options.search}%`))!)
  }

  const where = clauses.length > 0 ? and(...clauses) : undefined
  const pagination = options.pagination ?? { page: 1, pageSize: 25 }

  const [rows, total] = await Promise.all([
    db.findMany(trailers, {
      where,
      orderBy: desc(trailers.createdAt),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(trailers, where),
  ])

  return { rows, total }
}

/* ── Equipment types ─────────────────────────────────────────────────────── */

export async function listEquipmentTypes(
  db: TenantDb,
  category?: 'truck' | 'trailer',
  includeInactive = false,
): Promise<EquipmentType[]> {
  const clauses: SQL[] = []
  if (category) clauses.push(eq(equipmentTypes.category, category))
  if (!includeInactive) clauses.push(eq(equipmentTypes.active, true))
  return db.findMany(equipmentTypes, {
    where: clauses.length > 0 ? and(...clauses) : undefined,
    orderBy: [asc(equipmentTypes.sortOrder), asc(equipmentTypes.labelEn)],
  })
}

/* ── Detail view ─────────────────────────────────────────────────────────── */

export interface EquipmentDetail {
  equipment: Truck | Trailer
  equipmentType: EquipmentType | null
  compliance: ComplianceResult
  verification: EquipmentVerification | null
  media: EquipmentMedia[]
  missingAngles: string[]
  documents: Document[]
  loadCommitments: Array<{ assignment: LoadAssignment; load: Load }>
}

export async function getEquipmentDetail(
  db: TenantDb,
  equipmentType: EquipmentKind,
  equipmentId: string,
): Promise<EquipmentDetail> {
  const table = tableFor(equipmentType)
  const equipment = await db.requireById(table, equipmentId, equipmentType)

  const [type, compliance, verification, media, missingAngles, docs] = await Promise.all([
    equipment.equipmentTypeId ? db.findById(equipmentTypes, equipment.equipmentTypeId) : Promise.resolve(null),
    evaluateEquipmentForLoad(db, { equipmentType, equipmentId }),
    db.findFirst(equipmentVerifications, {
      where: and(eq(equipmentVerifications.equipmentType, equipmentType), eq(equipmentVerifications.equipmentId, equipmentId))!,
      orderBy: desc(equipmentVerifications.createdAt),
    }),
    db.findMany(equipmentMedia, {
      where: and(eq(equipmentMedia.equipmentType, equipmentType), eq(equipmentMedia.equipmentId, equipmentId))!,
      orderBy: asc(equipmentMedia.sortOrder),
    }),
    missingRequiredAngles(db, equipmentType, equipmentId),
    db.findMany(documents, {
      where: and(eq(documents.ownerType, equipmentType), eq(documents.ownerId, equipmentId))!,
      orderBy: desc(documents.createdAt),
    }),
  ])

  const truckOrTrailerColumn = equipmentType === 'truck' ? loadAssignments.truckId : loadAssignments.trailerId
  const commitmentRows = await db.findMany(loadAssignments, {
    where: and(eq(truckOrTrailerColumn, equipmentId), isNull(loadAssignments.unassignedAt))!,
    orderBy: desc(loadAssignments.committedFrom),
  })
  const loadIds = [...new Set(commitmentRows.map((r) => r.loadId))]
  const relatedLoads = loadIds.length > 0 ? await db.findMany(loads, { where: inArray(loads.id, loadIds) }) : []
  const loadById = new Map(relatedLoads.map((l) => [l.id, l]))
  const loadCommitments = commitmentRows
    .map((assignment) => {
      const load = loadById.get(assignment.loadId)
      return load ? { assignment, load } : null
    })
    .filter((v): v is { assignment: LoadAssignment; load: Load } => v !== null)

  return {
    equipment,
    equipmentType: type,
    compliance,
    verification,
    media,
    missingAngles,
    documents: docs,
    loadCommitments,
  }
}

/* ── Candidates for a load ───────────────────────────────────────────────── */

export interface EquipmentCandidate<T> {
  equipment: T
  compliance: ComplianceResult
}

export interface AvailableEquipmentWindow {
  from: Date
  to: Date
}

/**
 * Candidates for a specific load, each annotated with the exact blocking
 * reasons that would prevent assignment right now — never simply hidden, so
 * the assignment UI can explain *why* a unit is unavailable. Reuses the same
 * `equipmentGate`/`scheduleGate` predicates the dispatch gate itself uses
 * (`evaluateEquipmentForLoad` is the compliance module's own export); only
 * the schedule-conflict lookup is re-loaded here so the caller's own
 * `window` — not necessarily the load's currently saved dates — can be
 * evaluated (useful while a load is still being drafted).
 */
export async function availableEquipmentForLoad(
  db: TenantDb,
  loadId: string,
  window: AvailableEquipmentWindow,
  options: { equipmentType: EquipmentKind; carrierId?: string },
): Promise<Array<EquipmentCandidate<Truck | Trailer>>> {
  const table = tableFor(options.equipmentType)
  const clauses: SQL[] = [ne(table.status, 'archived')]
  if (options.carrierId) clauses.push(eq(table.carrierId, options.carrierId))

  const candidates = await db.findMany(table, { where: and(...clauses) })
  if (candidates.length === 0) return []

  const column = options.equipmentType === 'truck' ? loadAssignments.truckId : loadAssignments.trailerId
  const candidateIds = candidates.map((c) => c.id)
  const activeAssignments = await db.findMany(loadAssignments, {
    where: and(inArray(column, candidateIds), isNull(loadAssignments.unassignedAt), ne(loadAssignments.loadId, loadId))!,
  })
  const relatedLoadIds = [...new Set(activeAssignments.map((a) => a.loadId))]
  const relatedLoads = relatedLoadIds.length > 0 ? await db.findMany(loads, { where: inArray(loads.id, relatedLoadIds) }) : []
  const loadNumberById = new Map(relatedLoads.map((l) => [l.id, l.loadNumber]))

  const commitmentsByResource = new Map<string, Array<{ loadNumber: string; committedFrom: Date | null; committedTo: Date | null }>>()
  for (const assignment of activeAssignments) {
    const resourceId = options.equipmentType === 'truck' ? assignment.truckId : assignment.trailerId
    if (!resourceId) continue
    const list = commitmentsByResource.get(resourceId) ?? []
    list.push({
      loadNumber: loadNumberById.get(assignment.loadId) ?? assignment.loadId,
      committedFrom: assignment.committedFrom,
      committedTo: assignment.committedTo,
    })
    commitmentsByResource.set(resourceId, list)
  }

  return Promise.all(
    candidates.map(async (equipment) => {
      const [resourceResult, scheduleResult] = await Promise.all([
        evaluateEquipmentForLoad(db, { equipmentType: options.equipmentType, equipmentId: equipment.id }),
        Promise.resolve(
          scheduleGate({
            resourceType: options.equipmentType,
            resourceLabel: equipment.unitNumber,
            candidateWindow: window,
            existingCommitments: commitmentsByResource.get(equipment.id) ?? [],
          }),
        ),
      ])
      return { equipment, compliance: mergeComplianceResults([resourceResult, scheduleResult]) }
    }),
  )
}

/** Empty-scope convenience used by callers that already know they have nothing to show. */
export function emptyComplianceResult(): ComplianceResult {
  return toComplianceResult([])
}

/**
 * Resolves a `ResourceContext` for one truck/trailer from the real row — the
 * same pattern `equipmentResource()` in `actions.ts` uses for mutations, and
 * `resolveSignatureRequestResourceContext` uses for that module's detail
 * page — so a detail page can call `loadFor(permission, resource)` and get a
 * real scope check (a dispatcher or carrier user hitting the URL for a unit
 * outside their assignment is forbidden, not just hidden from the list).
 */
export async function getEquipmentResourceContext(
  db: TenantDb,
  equipmentType: EquipmentKind,
  equipmentId: string,
): Promise<{ tenantId: string | null; carrierId: string | null; truckId?: string; trailerId?: string }> {
  const table = tableFor(equipmentType)
  const record = await db.findById(table, equipmentId)
  return {
    tenantId: record?.tenantId ?? null,
    carrierId: record?.carrierId ?? null,
    ...(equipmentType === 'truck' ? { truckId: equipmentId } : { trailerId: equipmentId }),
  }
}

/**
 * Audit trail for one truck/trailer's History tab. Reads `audit_events`
 * directly (via the tenant-scoped `TenantDb`, never `unsafeDb`) rather than
 * adding a generic "history for entity" query to `lib/audit.ts`, which is
 * off limits here. Media and verification-override audit rows carry
 * `equipmentType`/`equipmentId` in their metadata (folded into
 * `afterSummary` by `recordAudit`) rather than as `entityId` — the row's own
 * `entityId` is the media/verification id — so this matches on that JSON
 * field. Entries are sparse by design: equipment create/update has no
 * `equipment.*` audit action (see `actions.ts`'s comment on why).
 */
export async function listEquipmentAuditHistory(
  db: TenantDb,
  equipmentType: EquipmentKind,
  equipmentId: string,
): Promise<AuditEvent[]> {
  return db.findMany(auditEvents, {
    where: and(
      inArray(auditEvents.entityType, ['equipmentMedia', 'equipmentVerification']),
      sql`${auditEvents.afterSummary} ->> 'equipmentId' = ${equipmentId}`,
      sql`${auditEvents.afterSummary} ->> 'equipmentType' = ${equipmentType}`,
    )!,
    orderBy: desc(auditEvents.occurredAt),
  })
}
