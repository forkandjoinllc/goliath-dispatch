import type { DateRangeInput, ResolvedDateRange } from './types'

/**
 * Date-range presets shared by every report and the filter bar.
 *
 * "daily" means today; "weekly" the last 7 days; "monthly" the current
 * calendar month; "yearly" the current calendar year — each ending at `now`
 * (or `asOf` in tests) so the report always reads "as of now", not a future
 * partial bucket. "custom" requires explicit `start`/`end`.
 */
export function resolveDateRange(input: DateRangeInput | undefined, asOf: Date = new Date()): ResolvedDateRange {
  const preset = input?.preset ?? 'monthly'

  if (preset === 'custom') {
    const start = input?.start ? new Date(input.start) : startOfMonth(asOf)
    const end = input?.end ? new Date(input.end) : asOf
    return { start, end, preset: 'custom' }
  }

  switch (preset) {
    case 'daily':
      return { start: startOfDay(asOf), end: asOf, preset }
    case 'weekly':
      return { start: new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000), end: asOf, preset }
    case 'yearly':
      return { start: startOfYear(asOf), end: asOf, preset }
    case 'monthly':
    default:
      return { start: startOfMonth(asOf), end: asOf, preset: 'monthly' }
  }
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1)
}

export const DATE_RANGE_PRESETS = ['daily', 'weekly', 'monthly', 'yearly', 'custom'] as const
