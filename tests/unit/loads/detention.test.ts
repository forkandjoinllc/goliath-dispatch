import { describe, expect, it } from 'vitest'
import { DEFAULT_FREE_TIME_MINUTES, calculateDetentionMinutes } from '@/server/loads/detention'

describe('calculateDetentionMinutes', () => {
  it('is zero when the stop finishes within the free-time window', () => {
    const arrived = new Date('2026-01-01T08:00:00Z')
    const departed = new Date('2026-01-01T09:30:00Z') // 90 minutes
    expect(calculateDetentionMinutes(arrived, departed)).toBe(0)
  })

  it('is zero exactly at the free-time boundary', () => {
    const arrived = new Date('2026-01-01T08:00:00Z')
    const departed = new Date(arrived.getTime() + DEFAULT_FREE_TIME_MINUTES * 60_000)
    expect(calculateDetentionMinutes(arrived, departed)).toBe(0)
  })

  it('accrues only the minutes past the free-time window', () => {
    const arrived = new Date('2026-01-01T08:00:00Z')
    const departed = new Date('2026-01-01T11:00:00Z') // 180 minutes
    expect(calculateDetentionMinutes(arrived, departed)).toBe(60)
  })

  it('honors a custom free-time allowance', () => {
    const arrived = new Date('2026-01-01T08:00:00Z')
    const departed = new Date('2026-01-01T09:00:00Z') // 60 minutes
    expect(calculateDetentionMinutes(arrived, departed, 30)).toBe(30)
  })

  it('never returns a negative number when departure precedes the free-time threshold', () => {
    const arrived = new Date('2026-01-01T08:00:00Z')
    const departed = new Date('2026-01-01T08:10:00Z')
    expect(calculateDetentionMinutes(arrived, departed)).toBe(0)
  })
})
