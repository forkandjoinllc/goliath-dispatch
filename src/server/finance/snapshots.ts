import 'server-only'
import { desc, eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { financialSnapshots, loads, type FinancialSnapshot, type Load } from '@/db/schema'
import {
  calculateLoadFinancials,
  groupApprovedExpenses,
  FORMULA_VERSION,
  type CommissionBasis,
} from '@/lib/money'
import { conflict, notFound } from '@/lib/errors'
import { recordAudit } from '@/lib/audit'
import { newId } from '@/lib/crypto'
import { listExpensesForLoad } from './expenses'
import { upsertCommissionForSnapshot } from './commissions'

/**
 * Financial snapshots — the append-only calculation history for a load.
 *
 * `onFinancialInputChanged` is the ONE entry point every other module
 * (loads, carriers, assignments — anything that edits a rate, a fee
 * percentage, a commission percentage, or approves an expense) must call
 * after changing something that feeds `calculateLoadFinancials`. It always:
 *   1. writes a brand-new `financial_snapshots` row (never an update — the
 *      database trigger in `drizzle/custom/0001_audit_immutability.sql`
 *      would reject an UPDATE to any computed column anyway),
 *   2. upserts the load's dispatcher commission for that snapshot, and
 *   3. writes a `financial.changed` audit event carrying the diff,
 * so a caller cannot recompute without also being audited, and cannot
 * approve/edit money without triggering a recompute.
 */

const SNAPSHOT_DIFF_FIELDS = [
  'customerChargeCents',
  'carrierGrossRateCents',
  'carrierDispatchFeeBps',
  'dispatcherCommissionBps',
  'dispatcherCommissionBasis',
  'approvedExcludedExpensesCents',
  'approvedReimbursableExpensesCents',
  'tenantAbsorbedExpensesCents',
  'carrierDeductionsCents',
  'commissionableBaseCents',
  'dispatchFeeAmountCents',
  'netCarrierSettlementCents',
  'grossMarginCents',
  'dispatcherCommissionAmountCents',
] as const satisfies ReadonlyArray<keyof FinancialSnapshot>

export interface SnapshotDiff {
  before: Record<string, unknown>
  after: Record<string, unknown>
}

function diffSnapshots(previous: FinancialSnapshot | null, next: FinancialSnapshot): SnapshotDiff {
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  for (const field of SNAPSHOT_DIFF_FIELDS) {
    const prevValue = previous ? previous[field] : null
    const nextValue = next[field]
    if (prevValue !== nextValue) {
      before[field] = prevValue
      after[field] = nextValue
    }
  }
  return { before, after }
}

export async function latestSnapshot(db: TenantDb, loadId: string): Promise<FinancialSnapshot | null> {
  return db.findFirst(financialSnapshots, {
    where: eq(financialSnapshots.loadId, loadId),
    orderBy: desc(financialSnapshots.version),
  })
}

export async function snapshotHistory(db: TenantDb, loadId: string): Promise<FinancialSnapshot[]> {
  return db.findMany(financialSnapshots, {
    where: eq(financialSnapshots.loadId, loadId),
    orderBy: desc(financialSnapshots.version),
  })
}

export interface RecomputeOptions {
  /** Short machine-readable reason, e.g. "expense_approved", "rate_changed". Stored on the snapshot. */
  reason: string
  actorUserId: string | null
}

export interface RecomputeResult {
  snapshot: FinancialSnapshot
  previous: FinancialSnapshot | null
  diff: SnapshotDiff
}

/**
 * Recomputes and versions a load's financial snapshot from its current
 * inputs (the load row's rate/fee/commission columns) and its currently
 * approved expenses. MUST be called from inside a `db.transaction()` when
 * combined with the input change that caused it (see `expenses.ts`'s
 * `approveExpense` and `updateLoadFinancialInputs` below), so the input
 * change and the resulting snapshot are always atomic together.
 */
export async function recomputeFinancials(
  db: TenantDb,
  loadId: string,
  options: RecomputeOptions,
): Promise<RecomputeResult> {
  const load: Load = await db.requireById(loads, loadId, 'load')
  const previous = await latestSnapshot(db, loadId)
  const loadExpenses = await listExpensesForLoad(db, loadId)

  const grouped = groupApprovedExpenses(
    loadExpenses.map((expense) => ({
      amountCents: expense.amountCents,
      treatmentSnapshot: expense.treatmentSnapshot,
      status: expense.status,
    })),
  )

  const outputs = calculateLoadFinancials({
    customerChargeCents: load.customerChargeCents,
    carrierGrossRateCents: load.carrierGrossRateCents,
    carrierDispatchFeeBps: load.carrierDispatchFeeBps,
    dispatcherCommissionBps: load.dispatcherCommissionBps,
    dispatcherCommissionBasis: load.dispatcherCommissionBasis,
    ...grouped,
  })

  const version = (previous?.version ?? 0) + 1

  let snapshot: FinancialSnapshot
  try {
    snapshot = await db.insert(financialSnapshots, {
      loadId,
      version,
      customerChargeCents: load.customerChargeCents,
      carrierGrossRateCents: load.carrierGrossRateCents,
      carrierDispatchFeeBps: load.carrierDispatchFeeBps,
      dispatcherCommissionBps: load.dispatcherCommissionBps,
      dispatcherCommissionBasis: load.dispatcherCommissionBasis,
      approvedExcludedExpensesCents: grouped.approvedExcludedExpensesCents,
      approvedReimbursableExpensesCents: grouped.approvedReimbursableExpensesCents,
      tenantAbsorbedExpensesCents: grouped.tenantAbsorbedExpensesCents,
      carrierDeductionsCents: grouped.carrierDeductionsCents,
      commissionableBaseCents: outputs.commissionableBaseCents,
      dispatchFeeAmountCents: outputs.dispatchFeeAmountCents,
      netCarrierSettlementCents: outputs.netCarrierSettlementCents,
      grossMarginCents: outputs.grossMarginCents,
      dispatcherCommissionAmountCents: outputs.dispatcherCommissionAmountCents,
      expenseBreakdown: loadExpenses
        .filter((expense) => expense.status === 'approved' || expense.status === 'reimbursed')
        .map((expense) => ({
          expenseId: expense.id,
          treatment: expense.treatmentSnapshot,
          amountCents: expense.amountCents,
        })),
      formulaVersion: FORMULA_VERSION,
      reason: options.reason,
      computedByUserId: options.actorUserId,
    })
  } catch {
    throw conflict('finance.errors.snapshotVersionConflict', { loadId })
  }

  await upsertCommissionForSnapshot(db, snapshot, load.dispatcherUserId)

  const diff = diffSnapshots(previous, snapshot)

  // Recorded directly (not via the caller's own action-level audit) so a
  // recompute is ALWAYS audited even when the trigger is a system process
  // (e.g. a webhook) with no full Actor available. The action that caused
  // the change (e.g. `expense.approved`) writes its own audit event too —
  // this one is specifically about the money.
  await recordAudit(
    null,
    { ipAddress: null, userAgent: null, requestId: newId() },
    {
      tenantId: db.tenantId,
      action: 'financial.changed',
      entityType: 'load',
      entityId: loadId,
      before: diff.before,
      after: diff.after,
      reason: options.reason,
      metadata: { actorUserId: options.actorUserId, snapshotId: snapshot.id, version: snapshot.version },
    },
  )

  return { snapshot, previous, diff }
}

/**
 * The single entry point documented above. Every other module should import
 * this name, not `recomputeFinancials` directly, when reacting to an input
 * change — the alias exists so the intent ("something upstream of the money
 * changed") is visible at every call site.
 */
export const onFinancialInputChanged = recomputeFinancials

/* ── Editing the financial inputs that live on `loads` ───────────────────── */

export interface UpdateLoadFinancialInputsInput {
  customerChargeCents?: number
  carrierGrossRateCents?: number
  carrierDispatchFeeBps?: number
  dispatcherCommissionBps?: number
  dispatcherCommissionBasis?: CommissionBasis
}

/**
 * Edits the rate/fee/commission columns that live on the `loads` table and
 * immediately recomputes. This is how `finance:update` (granted to
 * Accounting, who deliberately does NOT hold `load:update`) reaches those
 * columns without going through the loads module's own service layer.
 */
export async function updateLoadFinancialInputs(
  db: TenantDb,
  actor: { userId: string },
  loadId: string,
  input: UpdateLoadFinancialInputsInput,
): Promise<RecomputeResult> {
  return db.transaction(async (tx) => {
    await tx.requireById(loads, loadId, 'load')

    const patch: Partial<typeof loads.$inferInsert> = {}
    if (input.customerChargeCents != null) patch.customerChargeCents = input.customerChargeCents
    if (input.carrierGrossRateCents != null) patch.carrierGrossRateCents = input.carrierGrossRateCents
    if (input.carrierDispatchFeeBps != null) patch.carrierDispatchFeeBps = input.carrierDispatchFeeBps
    if (input.dispatcherCommissionBps != null) patch.dispatcherCommissionBps = input.dispatcherCommissionBps
    if (input.dispatcherCommissionBasis != null) patch.dispatcherCommissionBasis = input.dispatcherCommissionBasis

    if (Object.keys(patch).length > 0) {
      const updated = await tx.update(loads, loadId, patch)
      if (!updated) throw notFound('finance.errors.loadNotFound')
    }

    return recomputeFinancials(tx, loadId, { reason: 'financial_inputs_updated', actorUserId: actor.userId })
  })
}
