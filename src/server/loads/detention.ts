/**
 * Detention calculation. Pure and unit-tested in isolation
 * (`tests/unit/loads/detention.test.ts`) — the service layer only supplies
 * the two timestamps once a stop's departure is recorded.
 */

/** Minutes of free time before detention starts accruing. */
export const DEFAULT_FREE_TIME_MINUTES = 120

export function calculateDetentionMinutes(
  arrivedAt: Date,
  departedAt: Date,
  freeTimeMinutes: number = DEFAULT_FREE_TIME_MINUTES,
): number {
  const totalMinutes = Math.round((departedAt.getTime() - arrivedAt.getTime()) / 60_000)
  return Math.max(0, totalMinutes - freeTimeMinutes)
}
