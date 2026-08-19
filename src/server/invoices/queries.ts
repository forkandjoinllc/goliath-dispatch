import 'server-only'
import { and, asc, desc, eq, gt, gte, inArray, lte, notInArray, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  auditEvents,
  invoiceLineItems,
  invoices,
  paymentAttempts,
  payments,
  type AuditEvent,
  type Invoice,
  type InvoiceLineItem,
  type Payment,
  type PaymentAttempt,
} from '@/db/schema'
import type { invoiceStatusEnum } from '@/db/schema/_shared'
import type { ScopeFilter } from '@/lib/permissions/check'
import type { Pagination } from '@/lib/validation'

export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number]

/* ── Aging ────────────────────────────────────────────────────────────────── */

export type AgingBucket = 'current' | '0-30' | '31-60' | '61-90' | '90+'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Whole days past the due date. Zero or negative means not yet due. */
export function daysPastDue(dueDate: Date | null, asOf: Date): number {
  if (!dueDate) return 0
  return Math.floor((asOf.getTime() - dueDate.getTime()) / MS_PER_DAY)
}

/** Bucket boundaries are inclusive on the upper edge: day 30 is still "0-30". */
export function agingBucketForDays(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current'
  if (daysOverdue <= 30) return '0-30'
  if (daysOverdue <= 60) return '31-60'
  if (daysOverdue <= 90) return '61-90'
  return '90+'
}

export type AgingSummary = Record<AgingBucket, number>

function emptyAgingSummary(): AgingSummary {
  return { current: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
}

/** Open-balance receivables bucketed by days past due — the aging report/dashboard read model. */
export async function receivablesAgingSummary(
  db: TenantDb,
  scope: ScopeFilter,
  asOf: Date = new Date(),
): Promise<AgingSummary> {
  const scoped = invoiceScopeClause(scope)
  if (scoped === 'empty') return emptyAgingSummary()

  const clauses: SQL[] = [gt(invoices.balanceCents, 0), notInArray(invoices.status, ['voided'])]
  if (scoped) clauses.push(scoped)

  const openInvoices = await db.findMany(invoices, { where: and(...clauses) })
  const summary = emptyAgingSummary()
  for (const invoice of openInvoices) {
    const bucket = agingBucketForDays(daysPastDue(invoice.dueDate, asOf))
    summary[bucket] += invoice.balanceCents
  }
  return summary
}

/* ── Scoping ──────────────────────────────────────────────────────────────── */

function invoiceScopeClause(scope: ScopeFilter): SQL | 'empty' | undefined {
  switch (scope.kind) {
    case 'carrier':
      return scope.carrierId ? eq(invoices.carrierId, scope.carrierId) : 'empty'
    // Dispatchers and drivers hold no `invoice:read` grant at all in the
    // permission catalog; 'assigned'/'own' are listed only for exhaustiveness.
    case 'assigned':
    case 'own':
      return 'empty'
    case 'tenant':
    case 'platform':
    default:
      return undefined
  }
}

/* ── List ─────────────────────────────────────────────────────────────────── */

export interface ListInvoicesOptions {
  status?: InvoiceStatus
  carrierId?: string
  dueBefore?: Date
  dueAfter?: Date
  overdueOnly?: boolean
  pagination?: Pagination
}

export interface ListInvoicesResult {
  invoices: Invoice[]
  total: number
}

export async function listInvoices(
  db: TenantDb,
  scope: ScopeFilter,
  options: ListInvoicesOptions = {},
): Promise<ListInvoicesResult> {
  const scoped = invoiceScopeClause(scope)
  if (scoped === 'empty') return { invoices: [], total: 0 }

  const clauses: SQL[] = []
  if (scoped) clauses.push(scoped)
  if (options.status) clauses.push(eq(invoices.status, options.status))
  if (options.carrierId) clauses.push(eq(invoices.carrierId, options.carrierId))
  if (options.dueBefore) clauses.push(lte(invoices.dueDate, options.dueBefore))
  if (options.dueAfter) clauses.push(gte(invoices.dueDate, options.dueAfter))
  if (options.overdueOnly) {
    clauses.push(gt(invoices.balanceCents, 0))
    clauses.push(lte(invoices.dueDate, new Date()))
    clauses.push(notInArray(invoices.status, ['paid', 'voided']))
  }

  const where = clauses.length > 0 ? and(...clauses) : undefined
  const pagination = options.pagination ?? { page: 1, pageSize: 25 }

  const [rows, total] = await Promise.all([
    db.findMany(invoices, {
      where,
      orderBy: desc(invoices.createdAt),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(invoices, where),
  ])
  return { invoices: rows, total }
}

/* ── Detail ───────────────────────────────────────────────────────────────── */

export interface InvoiceDetail {
  invoice: Invoice
  lineItems: InvoiceLineItem[]
  payments: Payment[]
  attempts: PaymentAttempt[]
  auditHistory: AuditEvent[]
}

export async function getInvoiceDetail(db: TenantDb, invoiceId: string): Promise<InvoiceDetail | null> {
  const invoice = await db.findById(invoices, invoiceId)
  if (!invoice) return null

  const [lineItems, invoicePayments, attempts, auditHistory] = await Promise.all([
    db.findMany(invoiceLineItems, {
      where: eq(invoiceLineItems.invoiceId, invoiceId),
      orderBy: asc(invoiceLineItems.sequence),
    }),
    db.findMany(payments, { where: eq(payments.invoiceId, invoiceId), orderBy: desc(payments.createdAt) }),
    db.findMany(paymentAttempts, {
      where: eq(paymentAttempts.invoiceId, invoiceId),
      orderBy: desc(paymentAttempts.attemptedAt),
    }),
    db.findMany(auditEvents, {
      where: and(eq(auditEvents.entityType, 'invoice'), eq(auditEvents.entityId, invoiceId)),
      orderBy: desc(auditEvents.occurredAt),
    }),
  ])

  return { invoice, lineItems, payments: invoicePayments, attempts, auditHistory }
}

/* ── Receivables summary (dashboard) ─────────────────────────────────────── */

export interface ReceivablesSummary {
  outstandingCents: number
  overdueCents: number
  draftCount: number
  sentCount: number
  overdueCount: number
  disputedCount: number
}

export async function receivablesSummary(db: TenantDb, scope: ScopeFilter): Promise<ReceivablesSummary> {
  const scoped = invoiceScopeClause(scope)
  const empty: ReceivablesSummary = {
    outstandingCents: 0,
    overdueCents: 0,
    draftCount: 0,
    sentCount: 0,
    overdueCount: 0,
    disputedCount: 0,
  }
  if (scoped === 'empty') return empty

  const rows = await db.findMany(invoices, { where: scoped })
  const now = new Date()
  const summary = { ...empty }
  for (const invoice of rows) {
    if (invoice.status === 'draft') summary.draftCount += 1
    if (invoice.status === 'sent' || invoice.status === 'due') summary.sentCount += 1
    if (invoice.status === 'overdue') summary.overdueCount += 1
    if (invoice.status === 'disputed') summary.disputedCount += 1
    if (invoice.status !== 'voided' && invoice.status !== 'paid') {
      summary.outstandingCents += invoice.balanceCents
      if (invoice.dueDate && invoice.dueDate.getTime() < now.getTime() && invoice.balanceCents > 0) {
        summary.overdueCents += invoice.balanceCents
      }
    }
  }
  return summary
}

export async function listOverdueCandidates(db: TenantDb, asOf: Date): Promise<Invoice[]> {
  return db.findMany(invoices, {
    where: and(inArray(invoices.status, ['sent', 'due']), lte(invoices.dueDate, asOf), gt(invoices.balanceCents, 0)),
  })
}
