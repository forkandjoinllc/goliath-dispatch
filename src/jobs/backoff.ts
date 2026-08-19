/**
 * Retry backoff.
 *
 * Pure and deterministic given an injected RNG, so the schedule is exactly
 * unit-testable (`tests/unit/jobs/backoff.test.ts`) without touching a clock
 * or a database. `queue.ts`'s `fail()` is the only caller in production code.
 */

/** Delay applied after the Nth failed attempt: 1m, 5m, 25m, 2h, 10h, then capped at 10h. */
export const BACKOFF_STEPS_MS = [
  60_000, // 1m
  5 * 60_000, // 5m
  25 * 60_000, // 25m
  2 * 60 * 60_000, // 2h
  10 * 60 * 60_000, // 10h — the cap; every attempt beyond this reuses it
] as const

/** +/-15% jitter so a large batch that fails together doesn't retry in lockstep. */
const JITTER_RATIO = 0.15

/**
 * `attempt` is the 1-based count of the failure just recorded (the queue row's
 * `attempts` column after incrementing at claim time). Never returns less than
 * one second, so a misbehaving RNG can't produce an effectively-immediate retry.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const stepIndex = Math.min(Math.max(attempt, 1) - 1, BACKOFF_STEPS_MS.length - 1)
  const base = BACKOFF_STEPS_MS[stepIndex]!
  const jitter = base * JITTER_RATIO * (random() * 2 - 1)
  return Math.max(1_000, Math.round(base + jitter))
}

export function nextRunAtAfterFailure(attempt: number, now: Date = new Date(), random?: () => number): Date {
  return new Date(now.getTime() + backoffDelayMs(attempt, random))
}
