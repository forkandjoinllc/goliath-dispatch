/**
 * Money.
 *
 * Every amount in this system is an integer number of cents. No float ever
 * touches a monetary value: `0.1 + 0.2` problems become settlement disputes.
 * Percentages are basis points (1 bp = 0.01%), also integers.
 *
 * Rounding is half-up on the absolute value, which matches how a dispatcher
 * would compute a fee by hand and keeps `fee(a) + fee(b)` predictable.
 */

export type Cents = number
export type Bps = number

export const ZERO: Cents = 0

export function dollarsToCents(dollars: number | string): Cents {
  const numeric = typeof dollars === 'string' ? Number(dollars.replace(/[$,\s]/g, '')) : dollars
  if (!Number.isFinite(numeric)) throw new Error(`Cannot convert "${dollars}" to cents`)
  return Math.round(numeric * 100)
}

export function centsToDollars(cents: Cents): number {
  return cents / 100
}

export function percentToBps(percent: number): Bps {
  return Math.round(percent * 100)
}

export function bpsToPercent(bps: Bps): number {
  return bps / 100
}

/** Half-up rounding on magnitude, sign preserved. */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(Math.abs(value)) : Math.round(value)
}

/** Applies a basis-point rate to an amount of cents. */
export function applyBps(amount: Cents, bps: Bps): Cents {
  assertInteger(amount, 'amount')
  assertInteger(bps, 'bps')
  return roundHalfUp((amount * bps) / 10_000)
}

export function sum(...amounts: Array<Cents | null | undefined>): Cents {
  return amounts.reduce<number>((total, amount) => total + (amount ?? 0), 0)
}

export function subtract(minuend: Cents, ...subtrahends: Array<Cents | null | undefined>): Cents {
  return subtrahends.reduce<number>((total, amount) => total - (amount ?? 0), minuend)
}

export function clampAtZero(amount: Cents): Cents {
  return amount < 0 ? 0 : amount
}

function assertInteger(value: number, label: string) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer (got ${value}); money is always integer cents`)
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The load financial model
 *
 *   commissionableBase = carrierGrossRate − approvedExcludedExpenses
 *   dispatchFeeAmount  = commissionableBase × carrierDispatchFeePercentage
 *   netCarrierSettlement =
 *       carrierGrossRate + approvedReimbursableExpenses
 *       − dispatchFeeAmount − carrierDeductions
 *   grossMargin = customerCharge − carrierGrossRate − tenantAbsorbedExpenses
 *   dispatcherCommission = selectedBasis × dispatcherCommissionPercentage
 *
 * The dispatcher's commission is a cost to the dispatch company and is entirely
 * separate from the fee charged to the carrier — it never reduces the carrier's
 * settlement.
 * ──────────────────────────────────────────────────────────────────────────── */

export type CommissionBasis =
  | 'dispatch_fee_amount'
  | 'carrier_gross_rate'
  | 'commissionable_base'

export interface FinancialInputs {
  customerChargeCents: Cents
  carrierGrossRateCents: Cents
  carrierDispatchFeeBps: Bps
  dispatcherCommissionBps: Bps
  dispatcherCommissionBasis: CommissionBasis
  /** Approved expenses, already grouped by treatment. */
  approvedExcludedExpensesCents?: Cents
  approvedReimbursableExpensesCents?: Cents
  tenantAbsorbedExpensesCents?: Cents
  carrierDeductionsCents?: Cents
}

export interface FinancialOutputs {
  commissionableBaseCents: Cents
  dispatchFeeAmountCents: Cents
  netCarrierSettlementCents: Cents
  grossMarginCents: Cents
  dispatcherCommissionAmountCents: Cents
  dispatcherCommissionBasisAmountCents: Cents
}

export const FORMULA_VERSION = 'v1'

export function calculateLoadFinancials(inputs: FinancialInputs): FinancialOutputs {
  const {
    customerChargeCents,
    carrierGrossRateCents,
    carrierDispatchFeeBps,
    dispatcherCommissionBps,
    dispatcherCommissionBasis,
    approvedExcludedExpensesCents = 0,
    approvedReimbursableExpensesCents = 0,
    tenantAbsorbedExpensesCents = 0,
    carrierDeductionsCents = 0,
  } = inputs

  for (const [label, value] of Object.entries({
    customerChargeCents,
    carrierGrossRateCents,
    approvedExcludedExpensesCents,
    approvedReimbursableExpensesCents,
    tenantAbsorbedExpensesCents,
    carrierDeductionsCents,
  })) {
    assertInteger(value, label)
  }

  // Excluded expenses (permits, escorts by default) come off the top so the
  // dispatch company does not earn a fee on money that was passed through.
  const commissionableBaseCents = clampAtZero(
    subtract(carrierGrossRateCents, approvedExcludedExpensesCents),
  )

  const dispatchFeeAmountCents = applyBps(commissionableBaseCents, carrierDispatchFeeBps)

  const netCarrierSettlementCents = subtract(
    sum(carrierGrossRateCents, approvedReimbursableExpensesCents),
    dispatchFeeAmountCents,
    carrierDeductionsCents,
  )

  const grossMarginCents = subtract(
    customerChargeCents,
    carrierGrossRateCents,
    tenantAbsorbedExpensesCents,
  )

  const dispatcherCommissionBasisAmountCents =
    dispatcherCommissionBasis === 'carrier_gross_rate'
      ? carrierGrossRateCents
      : dispatcherCommissionBasis === 'commissionable_base'
        ? commissionableBaseCents
        : dispatchFeeAmountCents

  const dispatcherCommissionAmountCents = applyBps(
    dispatcherCommissionBasisAmountCents,
    dispatcherCommissionBps,
  )

  return {
    commissionableBaseCents,
    dispatchFeeAmountCents,
    netCarrierSettlementCents,
    grossMarginCents,
    dispatcherCommissionAmountCents,
    dispatcherCommissionBasisAmountCents,
  }
}

export type ExpenseTreatment =
  | 'excluded_from_commission'
  | 'reimbursable_to_carrier'
  | 'tenant_absorbed'
  | 'carrier_deduction'

export interface ExpenseLike {
  amountCents: Cents
  treatmentSnapshot: ExpenseTreatment
  status: string
}

/** Only approved expenses influence the money; submitted ones are advisory. */
export function groupApprovedExpenses(expenses: ExpenseLike[]) {
  const approved = expenses.filter((e) => e.status === 'approved' || e.status === 'reimbursed')
  const totals = {
    approvedExcludedExpensesCents: 0,
    approvedReimbursableExpensesCents: 0,
    tenantAbsorbedExpensesCents: 0,
    carrierDeductionsCents: 0,
  }
  for (const expense of approved) {
    switch (expense.treatmentSnapshot) {
      case 'excluded_from_commission':
        totals.approvedExcludedExpensesCents += expense.amountCents
        break
      case 'reimbursable_to_carrier':
        totals.approvedReimbursableExpensesCents += expense.amountCents
        break
      case 'tenant_absorbed':
        totals.tenantAbsorbedExpensesCents += expense.amountCents
        break
      case 'carrier_deduction':
        totals.carrierDeductionsCents += expense.amountCents
        break
    }
  }
  return totals
}

/** Margin as basis points of the customer charge; null when there is no charge. */
export function marginBps(grossMarginCents: Cents, customerChargeCents: Cents): Bps | null {
  if (customerChargeCents === 0) return null
  return roundHalfUp((grossMarginCents / customerChargeCents) * 10_000)
}
