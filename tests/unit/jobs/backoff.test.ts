import { describe, expect, it } from 'vitest'
import { BACKOFF_STEPS_MS, backoffDelayMs, nextRunAtAfterFailure } from '@/jobs/backoff'

const noJitter = () => 0.5 // random() * 2 - 1 === 0 → exact base, no jitter

describe('backoffDelayMs', () => {
  it('follows the documented schedule: 1m, 5m, 25m, 2h, 10h', () => {
    expect(backoffDelayMs(1, noJitter)).toBe(BACKOFF_STEPS_MS[0])
    expect(backoffDelayMs(2, noJitter)).toBe(BACKOFF_STEPS_MS[1])
    expect(backoffDelayMs(3, noJitter)).toBe(BACKOFF_STEPS_MS[2])
    expect(backoffDelayMs(4, noJitter)).toBe(BACKOFF_STEPS_MS[3])
    expect(backoffDelayMs(5, noJitter)).toBe(BACKOFF_STEPS_MS[4])
  })

  it('caps every attempt beyond the schedule at the final (10h) step', () => {
    expect(backoffDelayMs(6, noJitter)).toBe(BACKOFF_STEPS_MS[4])
    expect(backoffDelayMs(50, noJitter)).toBe(BACKOFF_STEPS_MS[4])
  })

  it('treats attempt 0 (or negative) the same as attempt 1', () => {
    expect(backoffDelayMs(0, noJitter)).toBe(BACKOFF_STEPS_MS[0])
    expect(backoffDelayMs(-3, noJitter)).toBe(BACKOFF_STEPS_MS[0])
  })

  it('applies jitter within +/-15% of the base delay', () => {
    const base = BACKOFF_STEPS_MS[2]
    const withMaxJitter = backoffDelayMs(3, () => 1) // random()*2-1 === 1 → +15%
    const withMinJitter = backoffDelayMs(3, () => 0) // random()*2-1 === -1 → -15%

    expect(withMaxJitter).toBeCloseTo(base * 1.15, -1)
    expect(withMinJitter).toBeCloseTo(base * 0.85, -1)
  })

  it('never returns less than one second even for a degenerate RNG', () => {
    expect(backoffDelayMs(1, () => -1000)).toBeGreaterThanOrEqual(1_000)
  })
})

describe('nextRunAtAfterFailure', () => {
  it('adds the backoff delay to the given clock', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const next = nextRunAtAfterFailure(1, now, noJitter)
    expect(next.getTime()).toBe(now.getTime() + BACKOFF_STEPS_MS[0])
  })
})
