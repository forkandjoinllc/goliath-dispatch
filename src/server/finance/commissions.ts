import 'server-only'
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { dispatcherCommissions, type DispatcherCommission, type FinancialSnapshot } from '@/db/schema'
import { conflict, notFound, validationFailed } from '@/lib/errors'

/**
 * Dispatcher commissions.
 *
 * A commission row is created once per (financial snapshot, dispatcher) —
 * never edited to reflect a new snapshot, since the snapshot it points to is
 * itself immutable history. `upsertCommissionForSnapshot` is called by
 * `snapshots.ts` inside the same transaction as every new snapshot, so a
 * snapshot and its commission are always created together.
 */

export type CommissionStatus = 'accrued' | 'approved' | 'paid' | 'voided'

const COMMISSION_TRANSITIONS: Record<CommissionStatus, CommissionStatus[]> = {
  accrued: ['approved', 'voided'],
  approved: ['paid', 'voided'],
  paid: [],
  voided: [],
}

export function canTransitionCommission(from: string, to: CommissionStatus): boolean {
  return (COMMISSION_TRANSITIONS[from as CommissionStatus] ?? []).includes(to)
}

function basisAmountFor(snapshot: FinancialSnapshot): number {
  switch (snapshot.dispatcherCommissionBasis) {
    case 'carrier_gross_rate':
      return snapshot.carrierGrossRateCents
    case 'commissionable_base':
      return snapshot.commissionableBaseCents
    case 'dispatch_fee_amount':
    default:
      return snapshot.dispatchFeeAmountCents
  }
}

/**
 * Creates the commission row for a newly computed snapshot. Any *other*
 * still-`accrued` commission for the same load/dispatcher (i.e. one attached
 * to a superseded snapshot version that was never approved) is voided first
 * — it no longer reflects the current truth. A commission that already
 * moved to `approved` or `paid` is left alone: it is settled history, and a
 * later recompute (e.g. a fee change) does not retroactively touch it.
 */
export async function upsertCommissionForSnapshot(
  db: TenantDb,
  snapshot: FinancialSnapshot,
  dispatcherUserId: string | null,
): Promise<DispatcherCommission | null> {
  if (!dispatcherUserId) return null

  const existingForSnapshot = await db.findFirst(dispatcherCommissions, {
    where: eq(dispatcherCommissions.financialSnapshotId, snapshot.id),
  })
  if (existingForSnapshot) return existingForSnapshot

  const staleAccrued = await db.findMany(dispatcherCommissions, {
    where: and(
      eq(dispatcherCommissions.loadId, snapshot.loadId),
      eq(dispatcherCommissions.dispatcherUserId, dispatcherUserId),
      eq(dispatcherCommissions.status, 'accrued'),
    ),
  })
  for (const stale of staleAccrued) {
    await db.update(dispatcherCommissions, stale.id, { status: 'voided' })
  }

  return db.insert(dispatcherCommissions, {
    loadId: snapshot.loadId,
    dispatcherUserId,
    financialSnapshotId: snapshot.id,
    basis: snapshot.dispatcherCommissionBasis,
    basisAmountCents: basisAmountFor(snapshot),
    percentageBps: snapshot.dispatcherCommissionBps,
    amountCents: snapshot.dispatcherCommissionAmountCents,
    status: 'accrued',
  })
}

/* ── Lifecycle ────────────────────────────────────────────────────────────── */

export async function transitionCommissionStatus(
  db: TenantDb,
  commissionId: string,
  toStatus: CommissionStatus,
): Promise<DispatcherCommission> {
  return db.transaction(async (tx) => {
    const commission = await tx.requireById(dispatcherCommissions, commissionId, 'dispatcherCommission')
    if (!canTransitionCommission(commission.status, toStatus)) {
      throw conflict('finance.errors.invalidCommissionTransition', {
        from: commission.status,
        to: toStatus,
      })
    }
    const updated = await tx.update(dispatcherCommissions, commissionId, {
      status: toStatus,
      paidAt: toStatus === 'paid' ? new Date() : commission.paidAt,
    })
    if (!updated) throw notFound('finance.errors.commissionNotFound')
    return updated
  })
}

export async function bulkTransitionCommissions(
  db: TenantDb,
  commissionIds: string[],
  toStatus: CommissionStatus,
): Promise<DispatcherCommission[]> {
  if (commissionIds.length === 0) throw validationFailed('finance.validation.selectAtLeastOne')
  const results: DispatcherCommission[] = []
  for (const id of commissionIds) {
    results.push(await transitionCommissionStatus(db, id, toStatus))
  }
  return results
}

/* ── Reads / summaries ────────────────────────────────────────────────────── */

export async function listCommissionsForLoad(db: TenantDb, loadId: string): Promise<DispatcherCommission[]> {
  return db.findMany(dispatcherCommissions, {
    where: eq(dispatcherCommissions.loadId, loadId),
    orderBy: desc(dispatcherCommissions.createdAt),
  })
}

export interface ListCommissionsOptions {
  dispatcherUserId?: string
  status?: CommissionStatus
  periodStart?: Date
  periodEnd?: Date
}

export async function listCommissions(
  db: TenantDb,
  options: ListCommissionsOptions = {},
): Promise<DispatcherCommission[]> {
  const clauses = []
  if (options.dispatcherUserId) clauses.push(eq(dispatcherCommissions.dispatcherUserId, options.dispatcherUserId))
  if (options.status) clauses.push(eq(dispatcherCommissions.status, options.status))
  if (options.periodStart) clauses.push(gte(dispatcherCommissions.createdAt, options.periodStart))
  if (options.periodEnd) clauses.push(lte(dispatcherCommissions.createdAt, options.periodEnd))

  return db.findMany(dispatcherCommissions, {
    where: clauses.length > 0 ? and(...clauses) : undefined,
    orderBy: [asc(dispatcherCommissions.dispatcherUserId), desc(dispatcherCommissions.createdAt)],
  })
}

export interface DispatcherCommissionPeriodSummary {
  dispatcherUserId: string
  loadCount: number
  accruedCents: number
  approvedCents: number
  paidCents: number
  voidedCents: number
  totalCents: number
}

/** Per-dispatcher totals for a period — the read model behind the commission dashboard/report. */
export async function commissionSummaryForPeriod(
  db: TenantDb,
  range: { start: Date; end: Date },
  dispatcherUserId?: string,
): Promise<DispatcherCommissionPeriodSummary[]> {
  const rows = await listCommissions(db, {
    periodStart: range.start,
    periodEnd: range.end,
    dispatcherUserId,
  })

  const byDispatcher = new Map<string, DispatcherCommissionPeriodSummary>()
  for (const row of rows) {
    const entry =
      byDispatcher.get(row.dispatcherUserId) ??
      ({
        dispatcherUserId: row.dispatcherUserId,
        loadCount: 0,
        accruedCents: 0,
        approvedCents: 0,
        paidCents: 0,
        voidedCents: 0,
        totalCents: 0,
      } satisfies DispatcherCommissionPeriodSummary)

    entry.loadCount += 1
    if (row.status === 'accrued') entry.accruedCents += row.amountCents
    else if (row.status === 'approved') entry.approvedCents += row.amountCents
    else if (row.status === 'paid') entry.paidCents += row.amountCents
    else if (row.status === 'voided') entry.voidedCents += row.amountCents

    if (row.status !== 'voided') entry.totalCents += row.amountCents

    byDispatcher.set(row.dispatcherUserId, entry)
  }
  return [...byDispatcher.values()]
}
