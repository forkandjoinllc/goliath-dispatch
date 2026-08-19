import 'server-only'
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  carrierSettlementLines,
  carrierSettlements,
  invoices,
  type CarrierSettlement,
  type Invoice,
} from '@/db/schema'
import type { ScopeFilter } from '@/lib/permissions/check'
import type { Pagination } from '@/lib/validation'
import type { CarrierSettlementLine, SettlementStatus } from './service'

function settlementScopeClause(scope: ScopeFilter): SQL | 'empty' | undefined {
  switch (scope.kind) {
    case 'carrier':
      return scope.carrierId ? eq(carrierSettlements.carrierId, scope.carrierId) : 'empty'
    case 'assigned':
    case 'own':
      return 'empty'
    case 'tenant':
    case 'platform':
    default:
      return undefined
  }
}

export interface ListSettlementsOptions {
  carrierId?: string
  status?: SettlementStatus
  pagination?: Pagination
}

export interface ListSettlementsResult {
  settlements: CarrierSettlement[]
  total: number
}

export async function listSettlements(
  db: TenantDb,
  scope: ScopeFilter,
  options: ListSettlementsOptions = {},
): Promise<ListSettlementsResult> {
  const scoped = settlementScopeClause(scope)
  if (scoped === 'empty') return { settlements: [], total: 0 }

  const clauses: SQL[] = []
  if (scoped) clauses.push(scoped)
  if (options.carrierId) clauses.push(eq(carrierSettlements.carrierId, options.carrierId))
  if (options.status) clauses.push(eq(carrierSettlements.status, options.status))

  const where = clauses.length > 0 ? and(...clauses) : undefined
  const pagination = options.pagination ?? { page: 1, pageSize: 25 }

  const [rows, total] = await Promise.all([
    db.findMany(carrierSettlements, {
      where,
      orderBy: desc(carrierSettlements.createdAt),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(carrierSettlements, where),
  ])
  return { settlements: rows, total }
}

export interface SettlementDetail {
  settlement: CarrierSettlement
  lines: CarrierSettlementLine[]
}

export async function getSettlementDetail(db: TenantDb, settlementId: string): Promise<SettlementDetail | null> {
  const settlement = await db.findById(carrierSettlements, settlementId)
  if (!settlement) return null
  const lines = await db.findMany(carrierSettlementLines, {
    where: eq(carrierSettlementLines.settlementId, settlementId),
  })
  return { settlement, lines }
}

/* ── Carrier statement (running account view) ────────────────────────────── */

export interface CarrierStatementEntry {
  date: Date
  kind: 'settlement_issued' | 'settlement_paid' | 'invoice_charge' | 'invoice_payment'
  referenceId: string
  referenceLabel: string
  /** Positive = money owed TO the carrier; negative = money owed BY the carrier. */
  amountCents: number
}

/**
 * A running account view across settlements (what the carrier is owed) and
 * invoices (what the carrier owes Goliath Dispatch for the dispatch fee) —
 * distinct from any single settlement's own statement.
 */
export async function carrierStatement(
  db: TenantDb,
  carrierId: string,
  range?: { start: Date; end: Date },
): Promise<CarrierStatementEntry[]> {
  const settlementClauses: SQL[] = [eq(carrierSettlements.carrierId, carrierId)]
  const invoiceClauses: SQL[] = [eq(invoices.carrierId, carrierId)]
  if (range) {
    settlementClauses.push(gte(carrierSettlements.periodEnd, range.start))
    settlementClauses.push(lte(carrierSettlements.periodEnd, range.end))
    invoiceClauses.push(gte(invoices.createdAt, range.start))
    invoiceClauses.push(lte(invoices.createdAt, range.end))
  }

  const [settlementRows, invoiceRows] = await Promise.all([
    db.findMany(carrierSettlements, { where: and(...settlementClauses) }),
    db.findMany(invoices, { where: and(...invoiceClauses) }),
  ])

  const entries: CarrierStatementEntry[] = []

  for (const settlement of settlementRows) {
    if (settlement.status === 'voided') continue
    if (settlement.issuedAt) {
      entries.push({
        date: settlement.issuedAt,
        kind: 'settlement_issued',
        referenceId: settlement.id,
        referenceLabel: settlement.settlementNumber,
        amountCents: settlement.netAmountCents,
      })
    }
  }

  for (const invoice of invoiceRows) {
    if (invoice.status === 'voided') continue
    if (invoice.issueDate) {
      entries.push({
        date: invoice.issueDate,
        kind: 'invoice_charge',
        referenceId: invoice.id,
        referenceLabel: invoice.invoiceNumber,
        amountCents: -invoice.totalCents,
      })
    }
    if (invoice.amountPaidCents > 0 && invoice.paidAt) {
      entries.push({
        date: invoice.paidAt,
        kind: 'invoice_payment',
        referenceId: invoice.id,
        referenceLabel: invoice.invoiceNumber,
        amountCents: invoice.amountPaidCents,
      })
    }
  }

  return entries.sort((a, b) => a.date.getTime() - b.date.getTime())
}

export type { Invoice }
