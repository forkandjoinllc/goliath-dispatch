import { describe, expect, it } from 'vitest'
import { agingBucketForDays, daysPastDue } from '@/server/invoices/queries'

/**
 * The receivables-aging report (`src/server/reports/definitions/receivables-aging.ts`)
 * wraps `receivablesAgingSummary`, which buckets on this exact function — so
 * pinning the boundaries here protects the report from drifting if the
 * invoices module's bucket edges ever change.
 */
describe('agingBucketForDays boundaries', () => {
  it('classifies non-positive days as current', () => {
    expect(agingBucketForDays(0)).toBe('current')
    expect(agingBucketForDays(-5)).toBe('current')
  })

  it('classifies day 1 as 0-30', () => {
    expect(agingBucketForDays(1)).toBe('0-30')
  })

  it('classifies exactly day 30 as 0-30 (inclusive upper edge)', () => {
    expect(agingBucketForDays(30)).toBe('0-30')
  })

  it('classifies day 31 as 31-60', () => {
    expect(agingBucketForDays(31)).toBe('31-60')
  })

  it('classifies exactly day 60 as 31-60', () => {
    expect(agingBucketForDays(60)).toBe('31-60')
  })

  it('classifies day 61 as 61-90', () => {
    expect(agingBucketForDays(61)).toBe('61-90')
  })

  it('classifies exactly day 90 as 61-90', () => {
    expect(agingBucketForDays(90)).toBe('61-90')
  })

  it('classifies day 91 as 90+', () => {
    expect(agingBucketForDays(91)).toBe('90+')
  })
})

describe('daysPastDue', () => {
  it('returns 0 when there is no due date', () => {
    expect(daysPastDue(null, new Date('2026-01-01'))).toBe(0)
  })

  it('returns whole days past the due date', () => {
    const due = new Date('2026-01-01T00:00:00Z')
    const asOf = new Date('2026-01-31T00:00:00Z')
    expect(daysPastDue(due, asOf)).toBe(30)
  })

  it('returns a non-positive number when not yet due', () => {
    const due = new Date('2026-02-01T00:00:00Z')
    const asOf = new Date('2026-01-01T00:00:00Z')
    expect(daysPastDue(due, asOf)).toBeLessThanOrEqual(0)
  })
})
