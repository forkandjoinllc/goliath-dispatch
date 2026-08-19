import { describe, expect, it } from 'vitest'
import {
  applyBps,
  calculateLoadFinancials,
  groupApprovedExpenses,
  marginBps,
  roundHalfUp,
} from '@/lib/money'

/**
 * The load financial model, tested against hand-computed fixtures. Every
 * assertion is an exact integer — a float comparison anywhere here would
 * defeat the point of the test.
 */

describe('calculateLoadFinancials', () => {
  it('zero rate: every downstream figure is zero', () => {
    const result = calculateLoadFinancials({
      customerChargeCents: 0,
      carrierGrossRateCents: 0,
      carrierDispatchFeeBps: 1000,
      dispatcherCommissionBps: 2500,
      dispatcherCommissionBasis: 'dispatch_fee_amount',
    })

    expect(result.commissionableBaseCents).toBe(0)
    expect(result.dispatchFeeAmountCents).toBe(0)
    expect(result.netCarrierSettlementCents).toBe(0)
    expect(result.grossMarginCents).toBe(0)
    expect(result.dispatcherCommissionAmountCents).toBe(0)
  })

  it('an excluded expense larger than the gross rate clamps the base at zero and zeroes the fee', () => {
    // $1,000.00 gross rate, a $1,500.00 permit (excluded from commission).
    const result = calculateLoadFinancials({
      customerChargeCents: 150_000,
      carrierGrossRateCents: 100_000,
      carrierDispatchFeeBps: 1000,
      dispatcherCommissionBps: 2500,
      dispatcherCommissionBasis: 'dispatch_fee_amount',
      approvedExcludedExpensesCents: 150_000,
    })

    expect(result.commissionableBaseCents).toBe(0)
    expect(result.dispatchFeeAmountCents).toBe(0)
    // Net settlement is unaffected by the excluded expense itself — it only
    // ever removes money from the commissionable base, never from what the
    // carrier is paid.
    expect(result.netCarrierSettlementCents).toBe(100_000)
    expect(result.dispatcherCommissionAmountCents).toBe(0)
  })

  it('rounds a half-cent up in magnitude regardless of sign (via applyBps/roundHalfUp)', () => {
    // 1000 cents * 125 bps / 10000 = 12.5 exactly.
    expect(applyBps(1000, 125)).toBe(13)
    expect(roundHalfUp(12.5)).toBe(13)
    expect(roundHalfUp(-12.5)).toBe(-13)
    expect(roundHalfUp(0.5)).toBe(1)
    expect(roundHalfUp(-0.5)).toBe(-1)
  })

  it('half-cent rounding flows through the full dispatch-fee calculation', () => {
    const result = calculateLoadFinancials({
      customerChargeCents: 0,
      carrierGrossRateCents: 1000,
      carrierDispatchFeeBps: 125, // 1.25%
      dispatcherCommissionBps: 0,
      dispatcherCommissionBasis: 'dispatch_fee_amount',
    })
    // 1000 * 125 / 10000 = 12.5 -> rounds up to 13.
    expect(result.dispatchFeeAmountCents).toBe(13)
  })

  it('computes each of the three dispatcher commission bases correctly on the same load', () => {
    const base = {
      customerChargeCents: 0,
      carrierGrossRateCents: 100_000, // $1,000.00 gross rate
      carrierDispatchFeeBps: 1000, // 10%
      dispatcherCommissionBps: 2500, // 25%
      approvedExcludedExpensesCents: 20_000, // $200.00 permit, excluded
    } as const

    const dispatchFee = calculateLoadFinancials({ ...base, dispatcherCommissionBasis: 'dispatch_fee_amount' })
    const carrierGross = calculateLoadFinancials({ ...base, dispatcherCommissionBasis: 'carrier_gross_rate' })
    const commissionableBase = calculateLoadFinancials({ ...base, dispatcherCommissionBasis: 'commissionable_base' })

    // commissionableBase = 100,000 - 20,000 = 80,000; dispatchFee = 80,000 * 10% = 8,000.
    expect(dispatchFee.commissionableBaseCents).toBe(80_000)
    expect(dispatchFee.dispatchFeeAmountCents).toBe(8_000)

    expect(dispatchFee.dispatcherCommissionAmountCents).toBe(2_000) // 8,000 * 25%
    expect(carrierGross.dispatcherCommissionAmountCents).toBe(25_000) // 100,000 * 25%
    expect(commissionableBase.dispatcherCommissionAmountCents).toBe(20_000) // 80,000 * 25%
  })

  it('handles a reimbursable expense and a carrier deduction on the same load', () => {
    const result = calculateLoadFinancials({
      customerChargeCents: 0,
      carrierGrossRateCents: 100_000,
      carrierDispatchFeeBps: 1000,
      dispatcherCommissionBps: 0,
      dispatcherCommissionBasis: 'dispatch_fee_amount',
      approvedReimbursableExpensesCents: 5_000,
      carrierDeductionsCents: 3_000,
    })

    // dispatchFee = 100,000 * 10% = 10,000
    // net = (100,000 + 5,000) - 10,000 - 3,000 = 92,000
    expect(result.dispatchFeeAmountCents).toBe(10_000)
    expect(result.netCarrierSettlementCents).toBe(92_000)
  })

  it('margin is null when the customer charge is zero, even with a real gross rate', () => {
    const result = calculateLoadFinancials({
      customerChargeCents: 0,
      carrierGrossRateCents: 50_000,
      carrierDispatchFeeBps: 1000,
      dispatcherCommissionBps: 0,
      dispatcherCommissionBasis: 'dispatch_fee_amount',
    })

    expect(result.grossMarginCents).toBe(-50_000)
    expect(marginBps(result.grossMarginCents, 0)).toBeNull()
  })

  it('margin as basis points of the customer charge, for a normal positive-margin load', () => {
    // $2,000 customer charge, $1,500 carrier gross rate -> $500 margin -> 25.00% (2500 bps).
    const result = calculateLoadFinancials({
      customerChargeCents: 200_000,
      carrierGrossRateCents: 150_000,
      carrierDispatchFeeBps: 1000,
      dispatcherCommissionBps: 0,
      dispatcherCommissionBasis: 'dispatch_fee_amount',
    })
    expect(result.grossMarginCents).toBe(50_000)
    expect(marginBps(result.grossMarginCents, 200_000)).toBe(2500)
  })
})

describe('groupApprovedExpenses', () => {
  it('only counts approved/reimbursed expenses, grouped by treatment', () => {
    const totals = groupApprovedExpenses([
      { amountCents: 10_000, treatmentSnapshot: 'excluded_from_commission', status: 'approved' },
      { amountCents: 5_000, treatmentSnapshot: 'reimbursable_to_carrier', status: 'approved' },
      { amountCents: 2_000, treatmentSnapshot: 'tenant_absorbed', status: 'reimbursed' },
      { amountCents: 3_000, treatmentSnapshot: 'carrier_deduction', status: 'approved' },
      // Not counted: still pending review.
      { amountCents: 99_999, treatmentSnapshot: 'excluded_from_commission', status: 'submitted' },
      // Not counted: rejected.
      { amountCents: 88_888, treatmentSnapshot: 'reimbursable_to_carrier', status: 'rejected' },
    ])

    expect(totals).toEqual({
      approvedExcludedExpensesCents: 10_000,
      approvedReimbursableExpensesCents: 5_000,
      tenantAbsorbedExpensesCents: 2_000,
      carrierDeductionsCents: 3_000,
    })
  })

  it('returns all-zero totals for an empty expense list', () => {
    expect(groupApprovedExpenses([])).toEqual({
      approvedExcludedExpensesCents: 0,
      approvedReimbursableExpensesCents: 0,
      tenantAbsorbedExpensesCents: 0,
      carrierDeductionsCents: 0,
    })
  })
})
