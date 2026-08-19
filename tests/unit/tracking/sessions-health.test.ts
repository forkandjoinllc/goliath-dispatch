import { describe, expect, it } from 'vitest'
import { computeSessionHealth, SESSION_LOST_AFTER_MINUTES, SESSION_STALE_AFTER_MINUTES } from '@/server/tracking/sessions'

const NOW = new Date('2026-06-01T12:00:00Z')

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000)
}

describe('computeSessionHealth', () => {
  it('is "ended" whenever the session has an endedAt, regardless of recency', () => {
    expect(computeSessionHealth({ endedAt: minutesAgo(1), lastEventAt: minutesAgo(1) }, NOW)).toBe('ended')
  })

  it('is "unknown" when no event has ever been received', () => {
    expect(computeSessionHealth({ endedAt: null, lastEventAt: null }, NOW)).toBe('unknown')
  })

  it('is "healthy" right up to the stale threshold', () => {
    expect(computeSessionHealth({ endedAt: null, lastEventAt: minutesAgo(SESSION_STALE_AFTER_MINUTES) }, NOW)).toBe(
      'healthy',
    )
  })

  it('becomes "stale" the instant it passes the stale threshold', () => {
    expect(
      computeSessionHealth({ endedAt: null, lastEventAt: minutesAgo(SESSION_STALE_AFTER_MINUTES + 1) }, NOW),
    ).toBe('stale')
  })

  it('stays "stale" right up to the lost threshold', () => {
    expect(computeSessionHealth({ endedAt: null, lastEventAt: minutesAgo(SESSION_LOST_AFTER_MINUTES) }, NOW)).toBe(
      'stale',
    )
  })

  it('becomes "lost" the instant it passes the lost threshold', () => {
    expect(
      computeSessionHealth({ endedAt: null, lastEventAt: minutesAgo(SESSION_LOST_AFTER_MINUTES + 1) }, NOW),
    ).toBe('lost')
  })
})
