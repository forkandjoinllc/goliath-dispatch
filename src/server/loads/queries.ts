import 'server-only'
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  carriers,
  checkCalls,
  customers,
  documentReviews,
  financialSnapshots,
  loadAssignments,
  loadStatusHistory,
  loadStops,
  loads,
  rateConfirmationAcceptances,
  users,
  type Carrier,
  type CheckCall,
  type Customer,
  type DocumentReview,
  type FinancialSnapshot,
  type Load,
  type LoadAssignment,
  type LoadStatusHistoryRow,
  type LoadStop,
  type RateConfirmationAcceptance,
} from '@/db/schema'
import type { Actor, ResourceContext } from '@/lib/permissions'
import type { ScopeFilter } from '@/lib/permissions/check'
import type { Pagination } from '@/lib/validation'
import { fullName } from '@/lib/utils'
import { listDocumentsForOwner, type DocumentWithCurrentVersion } from '@/server/documents/queries'
import { evaluateLoadForDispatch, type ComplianceResult } from '@/server/compliance'
import type { LoadStatus } from './status-machine'

/**
 * Read models for the load domain.
 *
 * `scopeClause` mirrors the shape used throughout the codebase
 * (`carriers/queries.ts`, `equipment/queries.ts`): it translates a
 * `ScopeFilter` into row-level predicates so a scoped list can never even
 * fetch a load outside the caller's reach. The `own` (driver) branch is the
 * one that needs a subquery — a driver's reach is "any load they have ever
 * been assigned to," which only `load_assignments` knows.
 */

async function driverLoadIds(db: TenantDb, driverId: string): Promise<string[]> {
  const rows = await db.findMany(loadAssignments, { where: eq(loadAssignments.driverId, driverId) })
  return [...new Set(rows.map((row) => row.loadId))]
}

async function scopeClause(db: TenantDb, scope: ScopeFilter): Promise<SQL | 'empty' | undefined> {
  switch (scope.kind) {
    case 'platform':
    case 'tenant':
      return undefined
    case 'assigned': {
      const clauses: SQL[] = [eq(loads.dispatcherUserId, scope.dispatcherUserId)]
      if (scope.carrierIds.length > 0) clauses.push(inArray(loads.carrierId, scope.carrierIds))
      return or(...clauses)
    }
    case 'carrier':
      return scope.carrierId ? eq(loads.carrierId, scope.carrierId) : 'empty'
    case 'own': {
      if (!scope.driverId) return 'empty'
      const ids = await driverLoadIds(db, scope.driverId)
      return ids.length > 0 ? inArray(loads.id, ids) : 'empty'
    }
    default:
      return 'empty'
  }
}

export interface LoadListFilters {
  status?: LoadStatus[]
  customerId?: string
  carrierId?: string
  dispatcherUserId?: string
  driverId?: string
  truckId?: string
  trailerId?: string
  dateFrom?: Date
  dateTo?: Date
  /** Matches load number, customer reference or PO number. */
  reference?: string
  oversizeOnly?: boolean
}

export type LoadListSortField =
  | 'loadNumber'
  | 'status'
  | 'plannedPickupAt'
  | 'plannedDeliveryAt'
  | 'customerChargeCents'
  | 'createdAt'

export interface LoadListSort {
  field: LoadListSortField
  direction: 'asc' | 'desc'
}

const SORT_COLUMNS = {
  loadNumber: loads.loadNumber,
  status: loads.status,
  plannedPickupAt: loads.plannedPickupAt,
  plannedDeliveryAt: loads.plannedDeliveryAt,
  customerChargeCents: loads.customerChargeCents,
  createdAt: loads.createdAt,
} as const

async function buildFilterClauses(db: TenantDb, filters: LoadListFilters): Promise<SQL[]> {
  const clauses: SQL[] = []
  if (filters.status && filters.status.length > 0) clauses.push(inArray(loads.status, filters.status))
  if (filters.customerId) clauses.push(eq(loads.customerId, filters.customerId))
  if (filters.carrierId) clauses.push(eq(loads.carrierId, filters.carrierId))
  if (filters.dispatcherUserId) clauses.push(eq(loads.dispatcherUserId, filters.dispatcherUserId))
  if (filters.dateFrom) clauses.push(gte(loads.plannedPickupAt, filters.dateFrom))
  if (filters.dateTo) clauses.push(lte(loads.plannedPickupAt, filters.dateTo))
  if (filters.oversizeOnly) clauses.push(eq(loads.isOversize, true))
  if (filters.reference) {
    clauses.push(
      or(
        ilike(loads.loadNumber, `%${filters.reference}%`),
        ilike(loads.customerReference, `%${filters.reference}%`),
        ilike(loads.poNumber, `%${filters.reference}%`),
      )!,
    )
  }
  if (filters.truckId || filters.trailerId || filters.driverId) {
    const resourceClauses: SQL[] = []
    if (filters.truckId) resourceClauses.push(eq(loadAssignments.truckId, filters.truckId))
    if (filters.trailerId) resourceClauses.push(eq(loadAssignments.trailerId, filters.trailerId))
    if (filters.driverId) resourceClauses.push(eq(loadAssignments.driverId, filters.driverId))
    const rows = await db.findMany(loadAssignments, { where: or(...resourceClauses) })
    const ids = [...new Set(rows.map((row) => row.loadId))]
    // `inArray` with an empty array compiles to `sql\`false\``, which is
    // exactly "no rows match" — no separate empty-list branch needed.
    clauses.push(inArray(loads.id, ids))
  }
  return clauses
}

export interface LoadListRow {
  load: Load
  customerName: string
  carrierName: string | null
  dispatcherName: string | null
}

export interface LoadListResult {
  rows: LoadListRow[]
  total: number
}

async function attachDisplayNames(db: TenantDb, rows: Load[]): Promise<LoadListRow[]> {
  if (rows.length === 0) return []
  const customerIds = [...new Set(rows.map((r) => r.customerId))]
  const carrierIds = [...new Set(rows.map((r) => r.carrierId).filter((id): id is string => Boolean(id)))]
  const dispatcherIds = [...new Set(rows.map((r) => r.dispatcherUserId).filter((id): id is string => Boolean(id)))]

  const [customerRows, carrierRows, dispatcherRows] = await Promise.all([
    db.findMany(customers, { where: inArray(customers.id, customerIds) }),
    carrierIds.length > 0 ? db.findMany(carriers, { where: inArray(carriers.id, carrierIds) }) : Promise.resolve([]),
    dispatcherIds.length > 0
      ? db.builderRequiringExplicitTenantPredicate
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, dispatcherIds))
      : Promise.resolve([]),
  ])
  const customerName = new Map(customerRows.map((c) => [c.id, c.companyName]))
  const carrierName = new Map(carrierRows.map((c) => [c.id, c.legalName]))
  const dispatcherName = new Map(dispatcherRows.map((u) => [u.id, fullName(u)]))

  return rows.map((load) => ({
    load,
    customerName: customerName.get(load.customerId) ?? '—',
    carrierName: load.carrierId ? (carrierName.get(load.carrierId) ?? null) : null,
    dispatcherName: load.dispatcherUserId ? (dispatcherName.get(load.dispatcherUserId) ?? null) : null,
  }))
}

/** Paginated, sorted list backing the table view. */
export async function listLoads(
  db: TenantDb,
  scope: ScopeFilter,
  filters: LoadListFilters = {},
  sort: LoadListSort = { field: 'createdAt', direction: 'desc' },
  pagination: Pagination = { page: 1, pageSize: 25 },
): Promise<LoadListResult> {
  const scoped = await scopeClause(db, scope)
  if (scoped === 'empty') return { rows: [], total: 0 }

  const clauses = await buildFilterClauses(db, filters)
  if (scoped) clauses.push(scoped)
  const where = clauses.length > 0 ? and(...clauses) : undefined

  const column = SORT_COLUMNS[sort.field]
  const orderBy = sort.direction === 'asc' ? asc(column) : desc(column)

  const [rows, total] = await Promise.all([
    db.findMany(loads, {
      where,
      orderBy,
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(loads, where),
  ])

  return { rows: await attachDisplayNames(db, rows), total }
}

/**
 * Un-paginated (bounded) projection shared by the board, calendar, timeline
 * and map views — they all need "every load matching the filters," just
 * rendered differently, so they share one query rather than four near-
 * identical ones. Bounded at 500 rows, which comfortably covers a single
 * dispatch floor's active board.
 */
export interface LoadViewsResult {
  rows: LoadListRow[]
  stopsByLoadId: Map<string, LoadStop[]>
}

const VIEW_ROW_LIMIT = 500

export async function listLoadsForViews(
  db: TenantDb,
  scope: ScopeFilter,
  filters: LoadListFilters = {},
): Promise<LoadViewsResult> {
  const scoped = await scopeClause(db, scope)
  if (scoped === 'empty') return { rows: [], stopsByLoadId: new Map() }

  const clauses = await buildFilterClauses(db, filters)
  if (scoped) clauses.push(scoped)
  const where = clauses.length > 0 ? and(...clauses) : undefined

  const rows = await db.findMany(loads, { where, orderBy: asc(loads.plannedPickupAt), limit: VIEW_ROW_LIMIT })
  const withNames = await attachDisplayNames(db, rows)

  const loadIds = rows.map((r) => r.id)
  const stops = loadIds.length > 0 ? await db.findMany(loadStops, { where: inArray(loadStops.loadId, loadIds), orderBy: asc(loadStops.sequence) }) : []
  const stopsByLoadId = new Map<string, LoadStop[]>()
  for (const stop of stops) {
    const list = stopsByLoadId.get(stop.loadId) ?? []
    list.push(stop)
    stopsByLoadId.set(stop.loadId, list)
  }

  return { rows: withNames, stopsByLoadId }
}

/* ── Detail ──────────────────────────────────────────────────────────────── */

export interface LoadDetail {
  load: Load
  customer: Customer
  carrier: Carrier | null
  stops: LoadStop[]
  assignments: LoadAssignment[]
  documents: DocumentWithCurrentVersion[]
  /** Every review decision across every document attached to this load, newest first — feeds the Documents tab's inline review panel. */
  documentReviews: DocumentReview[]
  statusHistory: LoadStatusHistoryRow[]
  compliance: ComplianceResult
  financialSnapshot: FinancialSnapshot | null
  checkCalls: CheckCall[]
  rateConfirmationDecisions: RateConfirmationAcceptance[]
}

export async function getLoadDetail(db: TenantDb, loadId: string): Promise<LoadDetail> {
  const load = await db.requireById(loads, loadId, 'load')

  const [customer, carrier, stops, assignments, documentRows, statusHistory, compliance, financialSnapshot, checkCallRows, rateDecisions] =
    await Promise.all([
      db.requireById(customers, load.customerId, 'customer'),
      load.carrierId ? db.findById(carriers, load.carrierId) : Promise.resolve(null),
      db.findMany(loadStops, { where: eq(loadStops.loadId, loadId), orderBy: asc(loadStops.sequence) }),
      db.findMany(loadAssignments, { where: eq(loadAssignments.loadId, loadId), orderBy: desc(loadAssignments.createdAt) }),
      listDocumentsForOwner(db, 'load', loadId),
      db.findMany(loadStatusHistory, { where: eq(loadStatusHistory.loadId, loadId), orderBy: desc(loadStatusHistory.occurredAt) }),
      evaluateLoadForDispatch(db, loadId),
      db.findFirst(financialSnapshots, { where: eq(financialSnapshots.loadId, loadId), orderBy: desc(financialSnapshots.version) }),
      db.findMany(checkCalls, { where: eq(checkCalls.loadId, loadId), orderBy: asc(checkCalls.scheduledFor) }),
      db.findMany(rateConfirmationAcceptances, { where: eq(rateConfirmationAcceptances.loadId, loadId), orderBy: desc(rateConfirmationAcceptances.decidedAt) }),
    ])

  const documentIds = documentRows.map((d) => d.id)
  const documentReviewRows =
    documentIds.length > 0
      ? await db.findMany(documentReviews, { where: inArray(documentReviews.documentId, documentIds), orderBy: desc(documentReviews.reviewedAt) })
      : []

  return {
    load,
    customer,
    carrier,
    stops,
    assignments,
    documents: documentRows,
    documentReviews: documentReviewRows,
    statusHistory,
    compliance,
    financialSnapshot: financialSnapshot ?? null,
    checkCalls: checkCallRows,
    rateConfirmationDecisions: rateDecisions,
  }
}

/**
 * Resolves a `ResourceContext` for one load, mirroring
 * `equipment/queries.ts::getEquipmentResourceContext` — used by the load
 * detail page and every mutating action so the scope check runs against the
 * load's real facts. `driverId` is only populated when the acting driver is
 * actually assigned to *this* load — the `own` scope check in
 * `resourceInScope()` requires an exact match, so an unassigned driver's own
 * `driverId` never accidentally satisfies it.
 */
export async function getLoadResourceContext(db: TenantDb, loadId: string, actor: Actor): Promise<ResourceContext> {
  const load = await db.findById(loads, loadId)
  if (!load) return { tenantId: db.tenantId }

  const context: ResourceContext = {
    tenantId: load.tenantId,
    carrierId: load.carrierId,
    dispatcherUserId: load.dispatcherUserId,
  }

  if (actor.role === 'driver' && actor.driverId) {
    const isAssigned = await db.exists(
      loadAssignments,
      and(eq(loadAssignments.loadId, loadId), eq(loadAssignments.driverId, actor.driverId))!,
    )
    if (isAssigned) context.driverId = actor.driverId
  }

  return context
}

export async function listDueCheckCallsForLoad(db: TenantDb, loadId: string): Promise<CheckCall[]> {
  return db.findMany(checkCalls, { where: eq(checkCalls.loadId, loadId), orderBy: asc(checkCalls.scheduledFor) })
}
