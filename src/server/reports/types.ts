import 'server-only'
import type { z } from 'zod'
import type { TenantDb } from '@/db/tenant-db'
import type { Locale } from '@/i18n/config'
import type { PermissionKey } from '@/lib/permissions'
import type { ScopeFilter } from '@/lib/permissions/check'

/**
 * The report registry contract.
 *
 * A report is a pure description of what to run and how to render it. The
 * background export handler and the interactive `app/reports` UI both call
 * `run()` through the same `runReport()` entry point (see `runner.ts`), so a
 * report cannot behave differently for a live user than it does for a queued
 * export — the scope enforcement lives here, once, not in either caller.
 */

export type ReportColumnType = 'string' | 'integer' | 'currency' | 'percent' | 'date' | 'bps'

export interface ReportColumn {
  key: string
  /** i18n key under the `report` namespace, e.g. "report.columns.customerName". */
  labelKey: string
  type: ReportColumnType
  /** Right-aligns and marks the column numeric in the DataTable and exports. */
  numeric?: boolean
}

export interface DateRangeInput {
  preset?: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
  start?: string
  end?: string
}

export interface ResolvedDateRange {
  start: Date
  end: Date
  preset: NonNullable<DateRangeInput['preset']>
}

export interface ReportChartHint {
  type: 'line' | 'bar' | 'donut'
  xKey: string
  series: Array<{ key: string; labelKey: string }>
}

export interface ReportRunContext<TFilters> {
  db: TenantDb
  tenantId: string
  scope: ScopeFilter
  filters: TFilters
  range: ResolvedDateRange
  locale: Locale
}

export interface ReportResult {
  columns: ReportColumn[]
  rows: Array<Record<string, unknown>>
  summary?: Record<string, unknown> | null
}

export interface ReportDefinition<TFilters = Record<string, unknown>> {
  key: string
  titleKey: string
  descriptionKey?: string
  requiredPermission: PermissionKey
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filterSchema: z.ZodType<TFilters, z.ZodTypeDef, any>
  /** Full column set at tenant scope. Narrower scopes may see a subset — see `run()`. */
  baseColumns: ReportColumn[]
  /** Whether the filter bar should show the date-range preset picker. */
  supportsDateRange: boolean
  chart?: ReportChartHint
  /**
   * Executes the report under the given scope and returns the exact columns
   * and rows the caller may see. Scope narrowing (row-level AND column-level)
   * happens inside this function — never in the UI, never after the fact.
   */
  run(ctx: ReportRunContext<TFilters>): Promise<ReportResult>
}

export function defineReport<TFilters>(definition: ReportDefinition<TFilters>): ReportDefinition<TFilters> {
  return definition
}
