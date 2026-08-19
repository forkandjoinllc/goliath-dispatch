import 'server-only'
import { and, desc, eq, ilike, inArray, isNotNull, lte, or, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { ownerLabelKey, type TenantDocumentRow } from './shared'

export { ownerLabelKey }
export type { TenantDocumentRow }
import {
  carriers,
  documentAccessLogs,
  documentReviews,
  documentVersions,
  documents,
  drivers,
  invoices,
  loads,
  tenants,
  trailers,
  trucks,
  type DocumentReview,
} from '@/db/schema'
import type { ScopeFilter } from '@/lib/permissions'
import type { Pagination } from '@/lib/validation'
import { fullName } from '@/lib/utils'

/**
 * Translates a `document:read` scope decision into a row-level predicate for
 * the tenant-wide list, the same guarantee `listCarriers`/`listTrucks` give a
 * single-domain list applied here across every owner type at once.
 *
 * `assigned` scope already carries explicit truck/trailer/driver id lists
 * (see `scopeFilter()`), so those map directly. `carrier` scope (a
 * carrier-portal user) only has its own `carrierId` — narrowing further to
 * "and this carrier's trucks/trailers/drivers" would need a query into the
 * equipment/driver modules this UI does not own, so it is intentionally
 * limited to that carrier's own carrier-level documents for now (flagged as
 * a known limitation in the final report, not silently widened to "all").
 * `own` (driver role) sees only that driver's own documents.
 */
function scopedDocumentOwnerClause(scope: ScopeFilter): SQL | 'all' | 'empty' {
  switch (scope.kind) {
    case 'platform':
    case 'tenant':
      return 'all'
    case 'assigned': {
      const ors: SQL[] = []
      if (scope.carrierIds.length > 0) ors.push(and(eq(documents.ownerType, 'carrier'), inArray(documents.ownerId, scope.carrierIds))!)
      if (scope.truckIds.length > 0) ors.push(and(eq(documents.ownerType, 'truck'), inArray(documents.ownerId, scope.truckIds))!)
      if (scope.trailerIds.length > 0) ors.push(and(eq(documents.ownerType, 'trailer'), inArray(documents.ownerId, scope.trailerIds))!)
      if (scope.driverIds.length > 0) ors.push(and(eq(documents.ownerType, 'driver'), inArray(documents.ownerId, scope.driverIds))!)
      return ors.length > 0 ? or(...ors)! : 'empty'
    }
    case 'carrier':
      return and(eq(documents.ownerType, 'carrier'), eq(documents.ownerId, scope.carrierId))!
    case 'own':
      return scope.driverId ? and(eq(documents.ownerType, 'driver'), eq(documents.ownerId, scope.driverId))! : 'empty'
    default:
      return 'empty'
  }
}

/**
 * Tenant-wide document read models for the `app/documents` screens.
 *
 * `src/server/documents/**` (owned by another agent) only exposes
 * per-owner (`listDocumentsForOwner`) and pending-review (`listPendingReview`)
 * listings — neither supports the filterable, paginated, all-owners view the
 * tenant-wide documents screen needs. This is an additive, page-level query
 * layer built on the same `documents`/`documentVersions`/`documentReviews`
 * tables (through the same tenant-scoped `TenantDb`), not a modification of
 * the owning module.
 */

export interface TenantDocumentFilters {
  documentType?: string
  ownerType?: string
  reviewStatus?: string
  /** Only documents expiring within this many days (including already expired). */
  expiringWithinDays?: number
  search?: string
  pagination?: Pagination
}

export interface ListTenantDocumentsResult {
  rows: TenantDocumentRow[]
  total: number
}

export async function listTenantDocuments(
  db: TenantDb,
  scope: ScopeFilter,
  filters: TenantDocumentFilters = {},
): Promise<ListTenantDocumentsResult> {
  const scopeClause = scopedDocumentOwnerClause(scope)
  if (scopeClause === 'empty') return { rows: [], total: 0 }

  const clauses: SQL[] = []
  if (scopeClause !== 'all') clauses.push(scopeClause)
  if (filters.documentType) clauses.push(eq(documents.documentType, filters.documentType as never))
  if (filters.ownerType) clauses.push(eq(documents.ownerType, filters.ownerType))
  if (filters.reviewStatus) clauses.push(eq(documents.reviewStatus, filters.reviewStatus as never))
  if (filters.expiringWithinDays != null) {
    const cutoff = new Date()
    cutoff.setUTCDate(cutoff.getUTCDate() + filters.expiringWithinDays)
    clauses.push(and(isNotNull(documents.expirationDate), lte(documents.expirationDate, cutoff))!)
  }
  if (filters.search) {
    clauses.push(or(ilike(documents.title, `%${filters.search}%`), ilike(documents.description, `%${filters.search}%`))!)
  }

  const where = clauses.length > 0 ? and(...clauses) : undefined
  const pagination = filters.pagination ?? { page: 1, pageSize: 25 }

  const [rows, total] = await Promise.all([
    db.findMany(documents, {
      where,
      orderBy: desc(documents.createdAt),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(documents, where),
  ])

  if (rows.length === 0) return { rows: [], total }

  const versionIds = rows.map((r) => r.currentVersionId).filter((id): id is string => Boolean(id))
  const versions = versionIds.length > 0 ? await db.findMany(documentVersions, { where: inArray(documentVersions.id, versionIds) }) : []
  const versionById = new Map(versions.map((v) => [v.id, v]))

  return {
    rows: rows.map((row) => ({ ...row, currentVersion: row.currentVersionId ? versionById.get(row.currentVersionId) ?? null : null })),
    total,
  }
}

/** All reviews for a set of documents, newest first per document. */
export async function reviewsForDocuments(db: TenantDb, documentIds: string[]): Promise<Map<string, DocumentReview[]>> {
  if (documentIds.length === 0) return new Map()
  const rows = await db.findMany(documentReviews, {
    where: inArray(documentReviews.documentId, documentIds),
    orderBy: desc(documentReviews.reviewedAt),
  })
  const byDocument = new Map<string, DocumentReview[]>()
  for (const row of rows) {
    const list = byDocument.get(row.documentId) ?? []
    list.push(row)
    byDocument.set(row.documentId, list)
  }
  return byDocument
}

/**
 * Best-effort human label for a document's polymorphic owner, resolved per
 * owner type. `tenant` (a company-wide policy document) and unrecognized
 * owner types fall back to the raw id — every owner type the compliance
 * catalog actually issues documents against (carrier, truck, trailer,
 * driver, load, invoice) is covered.
 */
export async function ownerLabelsFor(
  db: TenantDb,
  ownerRefs: Array<{ ownerType: string; ownerId: string }>,
): Promise<Map<string, string>> {
  const idsByType = new Map<string, Set<string>>()
  for (const ref of ownerRefs) {
    const set = idsByType.get(ref.ownerType) ?? new Set<string>()
    set.add(ref.ownerId)
    idsByType.set(ref.ownerType, set)
  }

  const result = new Map<string, string>()
  const key = (ownerType: string, ownerId: string) => `${ownerType}:${ownerId}`

  const carrierIds = [...(idsByType.get('carrier') ?? [])]
  if (carrierIds.length > 0) {
    const rows = await db.findMany(carriers, { where: inArray(carriers.id, carrierIds) })
    for (const row of rows) result.set(key('carrier', row.id), row.legalName)
  }

  const truckIds = [...(idsByType.get('truck') ?? [])]
  if (truckIds.length > 0) {
    const rows = await db.findMany(trucks, { where: inArray(trucks.id, truckIds) })
    for (const row of rows) result.set(key('truck', row.id), row.unitNumber)
  }

  const trailerIds = [...(idsByType.get('trailer') ?? [])]
  if (trailerIds.length > 0) {
    const rows = await db.findMany(trailers, { where: inArray(trailers.id, trailerIds) })
    for (const row of rows) result.set(key('trailer', row.id), row.unitNumber)
  }

  const driverIds = [...(idsByType.get('driver') ?? [])]
  if (driverIds.length > 0) {
    const rows = await db.findMany(drivers, { where: inArray(drivers.id, driverIds) })
    for (const row of rows) result.set(key('driver', row.id), fullName(row))
  }

  const loadIds = [...(idsByType.get('load') ?? [])]
  if (loadIds.length > 0) {
    const rows = await db.findMany(loads, { where: inArray(loads.id, loadIds) })
    for (const row of rows) result.set(key('load', row.id), row.loadNumber)
  }

  const invoiceIds = [...(idsByType.get('invoice') ?? [])]
  if (invoiceIds.length > 0) {
    const rows = await db.findMany(invoices, { where: inArray(invoices.id, invoiceIds) })
    for (const row of rows) result.set(key('invoice', row.id), row.invoiceNumber)
  }

  // `tenants` has no `tenantId` column (a tenant is its own scoping fact),
  // so the tenant-scoped `db.findMany` helper doesn't accept it — the only
  // tenant a document in this tenant-scoped `db` can ever be owned by is
  // the current tenant itself, so that is the explicit predicate required
  // by `builderRequiringExplicitTenantPredicate`.
  const tenantIds = [...(idsByType.get('tenant') ?? [])]
  if (tenantIds.length > 0) {
    const rows = await db.builderRequiringExplicitTenantPredicate
      .select({ id: tenants.id, displayName: tenants.displayName })
      .from(tenants)
      .where(and(inArray(tenants.id, tenantIds), eq(tenants.id, db.tenantId)))
    for (const row of rows) result.set(key('tenant', row.id), row.displayName)
  }

  return result
}

/** Document access-log entries for a document detail screen's access log. */
export async function accessLogFor(db: TenantDb, documentId: string) {
  return db.findMany(documentAccessLogs, {
    where: eq(documentAccessLogs.documentId, documentId),
    orderBy: desc(documentAccessLogs.createdAt),
  })
}
