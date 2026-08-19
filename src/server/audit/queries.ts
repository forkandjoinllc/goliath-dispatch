import 'server-only'
import { and, desc, eq, gte, isNotNull, lte, type SQL } from 'drizzle-orm'
import { auditEvents, impersonationSessions, type AuditEvent, type ImpersonationSession } from '@/db/schema'
import type { TenantDb } from '@/db/tenant-db'
import type { Pagination } from '@/lib/validation'

/**
 * Scope-aware audit queries.
 *
 * There is no write path here on purpose: `audit_events` is append-only at
 * the database level (`drizzle/custom/0001_audit_immutability.sql` rejects
 * UPDATE and DELETE), and this module exposes no method that could even
 * attempt one — it is `TenantDb.findMany`/`count` calls only.
 */

export interface AuditFilters {
  actorUserId?: string
  effectiveUserId?: string
  action?: string
  entityType?: string
  entityId?: string
  requestId?: string
  reasonPresent?: boolean
  dateFrom?: Date
  dateTo?: Date
}

export interface ListAuditEventsOptions {
  filters?: AuditFilters
  pagination?: Pagination
}

export interface ListAuditEventsResult {
  events: AuditEvent[]
  total: number
}

function buildClauses(filters: AuditFilters | undefined): SQL[] {
  const clauses: SQL[] = []
  if (!filters) return clauses
  if (filters.actorUserId) clauses.push(eq(auditEvents.actorUserId, filters.actorUserId))
  if (filters.effectiveUserId) clauses.push(eq(auditEvents.effectiveUserId, filters.effectiveUserId))
  if (filters.action) clauses.push(eq(auditEvents.action, filters.action as never))
  if (filters.entityType) clauses.push(eq(auditEvents.entityType, filters.entityType))
  if (filters.entityId) clauses.push(eq(auditEvents.entityId, filters.entityId))
  if (filters.requestId) clauses.push(eq(auditEvents.requestId, filters.requestId))
  if (filters.reasonPresent) clauses.push(isNotNull(auditEvents.reason))
  if (filters.dateFrom) clauses.push(gte(auditEvents.occurredAt, filters.dateFrom))
  if (filters.dateTo) clauses.push(lte(auditEvents.occurredAt, filters.dateTo))
  return clauses
}

export async function listAuditEvents(db: TenantDb, options: ListAuditEventsOptions = {}): Promise<ListAuditEventsResult> {
  const clauses = buildClauses(options.filters)
  const where = clauses.length > 0 ? and(...clauses) : undefined
  const pagination = options.pagination ?? { page: 1, pageSize: 50 }

  const [events, total] = await Promise.all([
    db.findMany(auditEvents, {
      where,
      orderBy: desc(auditEvents.occurredAt),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(auditEvents, where),
  ])

  return { events, total }
}

/** Every event sharing a request id — reconstructs one user action end to end. */
export async function listEventsByRequestId(db: TenantDb, requestId: string): Promise<AuditEvent[]> {
  return db.findMany(auditEvents, {
    where: eq(auditEvents.requestId, requestId),
    orderBy: desc(auditEvents.occurredAt),
  })
}

export interface ImpersonationSessionView {
  session: ImpersonationSession
  eventCount: number
}

/** Every impersonation session for the tenant, with a count of audit events recorded under it. */
export async function listImpersonationSessions(db: TenantDb): Promise<ImpersonationSessionView[]> {
  const sessions = await db.findMany(impersonationSessions, { orderBy: desc(impersonationSessions.startedAt) })
  const views: ImpersonationSessionView[] = []
  for (const session of sessions) {
    const eventCount = await db.count(auditEvents, eq(auditEvents.impersonationSessionId, session.id))
    views.push({ session, eventCount })
  }
  return views
}

export async function listEventsForImpersonationSession(db: TenantDb, impersonationSessionId: string): Promise<AuditEvent[]> {
  return db.findMany(auditEvents, {
    where: eq(auditEvents.impersonationSessionId, impersonationSessionId),
    orderBy: desc(auditEvents.occurredAt),
  })
}
