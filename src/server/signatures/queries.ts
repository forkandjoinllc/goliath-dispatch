import 'server-only'
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  signatureAuditEvents,
  signatureRecords,
  signatureRequests,
  signatureTemplates,
  type SignatureAuditEvent,
  type SignatureRecord,
  type SignatureRequest,
  type SignatureTemplate,
} from '@/db/schema'
import { can, scopeFilter, type Actor, type ResourceContext, type TenantPolicy } from '@/lib/permissions'
import { notFound } from '@/lib/errors'

/**
 * Read helpers for the signatures domain: resource-scope resolution for
 * `authorize()`, and the joined shapes the in-app screens render. Nothing
 * here mutates; `service.ts` owns every write.
 */

export async function resolveSignatureRequestResourceContext(
  db: TenantDb,
  requestId: string,
): Promise<ResourceContext> {
  const request = await db.findById(signatureRequests, requestId)
  if (!request) return { tenantId: db.tenantId }
  return { tenantId: request.tenantId, carrierId: request.carrierId ?? undefined }
}

export interface SignatureRequestWithTemplate extends SignatureRequest {
  template: SignatureTemplate | null
}

async function attachTemplates(
  db: TenantDb,
  rows: SignatureRequest[],
): Promise<SignatureRequestWithTemplate[]> {
  if (rows.length === 0) return []
  const templateIds = [...new Set(rows.map((r) => r.templateId))]
  const templates = await db.findMany(signatureTemplates, { where: inArray(signatureTemplates.id, templateIds) })
  const byId = new Map(templates.map((t) => [t.id, t]))
  return rows.map((row) => ({ ...row, template: byId.get(row.templateId) ?? null }))
}

export interface ListSignatureRequestsFilter {
  status?: SignatureRequest['status']
  subjectType?: string
  subjectId?: string
  carrierId?: string
}

/** Every signature request for the tenant, newest first. Filters are applied server-side, not by the client. */
export async function listSignatureRequests(
  db: TenantDb,
  filter: ListSignatureRequestsFilter = {},
  extraClause?: SQL,
): Promise<SignatureRequestWithTemplate[]> {
  const clauses = [
    filter.status ? eq(signatureRequests.status, filter.status) : undefined,
    filter.subjectType ? eq(signatureRequests.subjectType, filter.subjectType) : undefined,
    filter.subjectId ? eq(signatureRequests.subjectId, filter.subjectId) : undefined,
    filter.carrierId ? eq(signatureRequests.carrierId, filter.carrierId) : undefined,
    extraClause,
  ].filter((c): c is NonNullable<typeof c> => c != null)

  const rows = await db.findMany(signatureRequests, {
    where: clauses.length > 0 ? and(...clauses) : undefined,
    orderBy: desc(signatureRequests.requestedAt),
  })
  return attachTemplates(db, rows)
}

/**
 * Scope-aware listing for the index screen: a dispatcher whose grant is
 * `assigned` must not even receive rows for a carrier they are not assigned
 * to, and a carrier-role actor sees only their own carrier's requests. The
 * single-record checks in `authorize()` are not enough on their own — the
 * query itself has to apply the same narrowing (see
 * `tests/integration/carriers/dispatcher-scope.test.ts` for the pattern this
 * mirrors).
 */
export async function listSignatureRequestsForActor(
  db: TenantDb,
  actor: Actor,
  policy: TenantPolicy | null,
  filter: ListSignatureRequestsFilter = {},
): Promise<SignatureRequestWithTemplate[]> {
  const decision = can(actor, 'signature:request:read', undefined, policy)
  if (!decision.allowed || !decision.scope) return []

  const scope = scopeFilter(actor, decision.scope)
  const scopeClause =
    scope.kind === 'assigned'
      ? scope.carrierIds.length > 0
        ? inArray(signatureRequests.carrierId, scope.carrierIds)
        : null
      : scope.kind === 'carrier'
        ? eq(signatureRequests.carrierId, scope.carrierId)
        : undefined

  // An 'assigned' actor with no assignments at all sees nothing — never falls
  // through to an unscoped (tenant-wide) query.
  if (scopeClause === null) return []

  return listSignatureRequests(db, filter, scopeClause)
}

/** Narrows `findRequestsNeedingResignature`'s output to what this actor's scope allows. */
export function filterRequestsForScope<T extends { carrierId: string | null }>(
  rows: T[],
  actor: Actor,
  policy: TenantPolicy | null,
): T[] {
  const decision = can(actor, 'signature:request:read', undefined, policy)
  if (!decision.allowed || !decision.scope) return []
  const scope = scopeFilter(actor, decision.scope)
  if (scope.kind === 'assigned') {
    return rows.filter((row) => row.carrierId != null && scope.carrierIds.includes(row.carrierId))
  }
  if (scope.kind === 'carrier') {
    return rows.filter((row) => row.carrierId === scope.carrierId)
  }
  return rows
}

export interface SignatureRequestDetail {
  request: SignatureRequestWithTemplate
  record: SignatureRecord | null
  events: SignatureAuditEvent[]
}

/** Full detail for one request: itself (with its pinned template), its record if signed, and its complete ceremony log in order. */
export async function getSignatureRequestDetail(
  db: TenantDb,
  requestId: string,
): Promise<SignatureRequestDetail> {
  const request = await db.requireById(signatureRequests, requestId, 'signatureRequest')
  const [[withTemplate], record, events] = await Promise.all([
    attachTemplates(db, [request]),
    db.findFirst(signatureRecords, { where: eq(signatureRecords.requestId, requestId) }),
    db.findMany(signatureAuditEvents, {
      where: eq(signatureAuditEvents.requestId, requestId),
      orderBy: [asc(signatureAuditEvents.occurredAt), asc(signatureAuditEvents.id)],
    }),
  ])

  if (!withTemplate) throw notFound('signature.errors.requestNotFound')
  return { request: withTemplate, record: record ?? null, events }
}

export async function getSignatureRecordByRequestId(
  db: TenantDb,
  requestId: string,
): Promise<SignatureRecord | null> {
  return db.findFirst(signatureRecords, { where: eq(signatureRecords.requestId, requestId) })
}

export async function listAuditEventsForRequest(
  db: TenantDb,
  requestId: string,
): Promise<SignatureAuditEvent[]> {
  return db.findMany(signatureAuditEvents, {
    where: eq(signatureAuditEvents.requestId, requestId),
    orderBy: [asc(signatureAuditEvents.occurredAt), asc(signatureAuditEvents.id)],
  })
}
