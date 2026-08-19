import { describe, expect, it } from 'vitest'
import { applyPaymentToInvoice, canTransitionInvoice } from '@/server/invoices/service'
import { agingBucketForDays, daysPastDue } from '@/server/invoices/queries'

describe('invoice status transitions', () => {
  const ALL_STATUSES = ['draft', 'sent', 'due', 'paid', 'overdue', 'disputed', 'voided', 'uncollectable'] as const

  it('allows the documented happy path', () => {
    expect(canTransitionInvoice('draft', 'sent')).toBe(true)
    expect(canTransitionInvoice('sent', 'due')).toBe(true)
    expect(canTransitionInvoice('due', 'paid')).toBe(true)
  })

  it('allows the documented forks off "due"', () => {
    expect(canTransitionInvoice('due', 'overdue')).toBe(true)
    expect(canTransitionInvoice('due', 'disputed')).toBe(true)
    expect(canTransitionInvoice('due', 'voided')).toBe(true)
    expect(canTransitionInvoice('due', 'uncollectable')).toBe(true)
  })

  it('a paid invoice is terminal: no transition out of "paid" is allowed', () => {
    for (const to of ALL_STATUSES) {
      expect(canTransitionInvoice('paid', to)).toBe(false)
    }
  })

  it('a voided invoice is terminal', () => {
    for (const to of ALL_STATUSES) {
      expect(canTransitionInvoice('voided', to)).toBe(false)
    }
  })

  it('rejects an invalid jump backward from a settled state', () => {
    expect(canTransitionInvoice('overdue', 'draft')).toBe(false)
    expect(canTransitionInvoice('overdue', 'sent')).toBe(false)
  })

  it('an uncollectable invoice can still be recovered to paid', () => {
    expect(canTransitionInvoice('uncollectable', 'paid')).toBe(true)
    expect(canTransitionInvoice('uncollectable', 'sent')).toBe(false)
  })
})

describe('partial payment arithmetic', () => {
  const freshInvoice = { totalCents: 10_000, amountPaidCents: 0, balanceCents: 10_000, status: 'sent' as const }

  it('a partial payment reduces the balance and keeps the invoice open', () => {
    const result = applyPaymentToInvoice(freshInvoice, 4_000)
    expect(result).toEqual({ amountPaidCents: 4_000, balanceCents: 6_000, status: 'sent' })
  })

  it('two partial payments in sequence reach exactly zero and flip the invoice to paid', () => {
    const first = applyPaymentToInvoice(freshInvoice, 6_000)
    expect(first).toEqual({ amountPaidCents: 6_000, balanceCents: 4_000, status: 'sent' })

    const second = applyPaymentToInvoice(
      { totalCents: 10_000, amountPaidCents: first.amountPaidCents, balanceCents: first.balanceCents, status: first.status },
      4_000,
    )
    expect(second).toEqual({ amountPaidCents: 10_000, balanceCents: 0, status: 'paid' })
  })

  it('a payment that exactly matches the balance completes the invoice', () => {
    const result = applyPaymentToInvoice(freshInvoice, 10_000)
    expect(result.balanceCents).toBe(0)
    expect(result.status).toBe('paid')
  })

  it('rejects a payment greater than the current balance, naming the maximum', () => {
    expect(() => applyPaymentToInvoice(freshInvoice, 10_001)).toThrowError(
      expect.objectContaining({
        code: 'validation_failed',
        messageKey: 'finance.validation.overpayment',
        params: { maxAmount: '100.00' },
      }),
    )
  })

  it('rejects a zero or negative amount', () => {
    expect(() => applyPaymentToInvoice(freshInvoice, 0)).toThrow()
    expect(() => applyPaymentToInvoice(freshInvoice, -500)).toThrow()
  })

  it('a payment against a draft invoice nudges it to sent, not paid, unless it clears the balance', () => {
    const draft = { totalCents: 10_000, amountPaidCents: 0, balanceCents: 10_000, status: 'draft' as const }
    const result = applyPaymentToInvoice(draft, 1_000)
    expect(result.status).toBe('sent')
  })

  it('the balance never goes negative even at the boundary', () => {
    const result = applyPaymentToInvoice(freshInvoice, 10_000)
    expect(result.balanceCents).toBe(0)
    expect(result.balanceCents).toBeGreaterThanOrEqual(0)
  })
})

describe('aging buckets', () => {
  it('is "current" for anything not yet past due', () => {
    expect(agingBucketForDays(0)).toBe('current')
    expect(agingBucketForDays(-5)).toBe('current')
  })

  it('boundaries are inclusive at exactly 30, 60 and 90 days', () => {
    expect(agingBucketForDays(1)).toBe('0-30')
    expect(agingBucketForDays(30)).toBe('0-30')
    expect(agingBucketForDays(31)).toBe('31-60')
    expect(agingBucketForDays(60)).toBe('31-60')
    expect(agingBucketForDays(61)).toBe('61-90')
    expect(agingBucketForDays(90)).toBe('61-90')
    expect(agingBucketForDays(91)).toBe('90+')
  })

  it('daysPastDue computes whole days between the due date and "as of"', () => {
    const dueDate = new Date('2026-07-01T00:00:00Z')
    expect(daysPastDue(dueDate, new Date('2026-07-01T00:00:00Z'))).toBe(0)
    expect(daysPastDue(dueDate, new Date('2026-07-31T00:00:00Z'))).toBe(30)
    expect(daysPastDue(dueDate, new Date('2026-08-01T00:00:00Z'))).toBe(31)
    expect(daysPastDue(null, new Date())).toBe(0)
  })
})
