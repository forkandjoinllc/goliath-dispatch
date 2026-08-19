import { describe, expect, it } from 'vitest'
import { canTransitionCommission } from '@/server/finance/commissions'
import { canTransitionSettlement } from '@/server/settlements/service'

describe('dispatcher commission status transitions', () => {
  it('follows accrued -> approved -> paid', () => {
    expect(canTransitionCommission('accrued', 'approved')).toBe(true)
    expect(canTransitionCommission('approved', 'paid')).toBe(true)
  })

  it('allows voiding from accrued or approved, never from paid', () => {
    expect(canTransitionCommission('accrued', 'voided')).toBe(true)
    expect(canTransitionCommission('approved', 'voided')).toBe(true)
    expect(canTransitionCommission('paid', 'voided')).toBe(false)
  })

  it('rejects skipping straight from accrued to paid', () => {
    expect(canTransitionCommission('accrued', 'paid')).toBe(false)
  })

  it('paid and voided are terminal', () => {
    for (const to of ['accrued', 'approved', 'paid', 'voided'] as const) {
      expect(canTransitionCommission('paid', to)).toBe(false)
      expect(canTransitionCommission('voided', to)).toBe(false)
    }
  })
})

describe('carrier settlement status transitions', () => {
  it('follows draft -> issued -> paid', () => {
    expect(canTransitionSettlement('draft', 'issued')).toBe(true)
    expect(canTransitionSettlement('issued', 'paid')).toBe(true)
  })

  it('allows voiding a draft or issued settlement, never a paid one', () => {
    expect(canTransitionSettlement('draft', 'voided')).toBe(true)
    expect(canTransitionSettlement('issued', 'voided')).toBe(true)
    expect(canTransitionSettlement('paid', 'voided')).toBe(false)
  })

  it('rejects skipping straight from draft to paid', () => {
    expect(canTransitionSettlement('draft', 'paid')).toBe(false)
  })

  it('paid and voided are terminal', () => {
    for (const to of ['draft', 'issued', 'paid', 'voided'] as const) {
      expect(canTransitionSettlement('paid', to)).toBe(false)
      expect(canTransitionSettlement('voided', to)).toBe(false)
    }
  })
})
