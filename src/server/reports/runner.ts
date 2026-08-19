import 'server-only'
import type { TenantDb } from '@/db/tenant-db'
import type { Locale } from '@/i18n/config'
import { authorize, scopeFilter, type Actor, type ScopeFilter, type TenantPolicy } from '@/lib/permissions'
import { notFound, validationFailed } from '@/lib/errors'
import { getReport } from './registry'
import { resolveDateRange } from './date-ranges'
import type { ReportResult } from './types'

/**
 * The single execution path for every report. Both the interactive
 * `app/reports` UI (via `runReportForActor`) and the export job handler (via
 * `runReportWithScope`) end up here — scope enforcement lives inside each
 * report's own `run()`, never in either caller, and an export replays the
 * exact scope it was requested under rather than whatever authority the
 * background worker happens to run as.
 */

export interface RunReportOptions {
  reportKey: string
  db: TenantDb
  tenantId: string
  scope: ScopeFilter
  rawFilters: unknown
  locale: Locale
}

export async function executeReport(options: RunReportOptions): Promise<ReportResult> {
  const definition = getReport(options.reportKey)
  if (!definition) throw notFound('report.errors.unknownReport', { reportKey: options.reportKey })

  const parsed = definition.filterSchema.safeParse(options.rawFilters ?? {})
  if (!parsed.success) throw validationFailed('errors.validationFailed', parsed.error.flatten())

  const filters = parsed.data as Record<string, unknown>
  const range = resolveDateRange(
    definition.supportsDateRange ? (filters as { range?: Parameters<typeof resolveDateRange>[0] }).range : undefined,
  )

  return definition.run({
    db: options.db,
    tenantId: options.tenantId,
    scope: options.scope,
    filters: parsed.data,
    range,
    locale: options.locale,
  })
}

/** Interactive path: resolves scope from a live Actor and authorizes first. */
export async function runReportForActor(input: {
  reportKey: string
  actor: Actor & { tenantId: string }
  policy: TenantPolicy | null
  db: TenantDb
  rawFilters: unknown
  locale: Locale
}): Promise<ReportResult> {
  const definition = getReport(input.reportKey)
  if (!definition) throw notFound('report.errors.unknownReport', { reportKey: input.reportKey })

  const scopeGranted = authorize(input.actor, definition.requiredPermission, undefined, input.policy)
  const scope = scopeFilter(input.actor, scopeGranted)

  return executeReport({
    reportKey: input.reportKey,
    db: input.db,
    tenantId: input.actor.tenantId,
    scope,
    rawFilters: input.rawFilters,
    locale: input.locale,
  })
}

/**
 * Export-generation path: takes a previously *snapshotted* `ScopeFilter`
 * (see `src/server/exports/service.ts`) rather than an Actor, so a worker
 * with no logged-in user still reproduces exactly what the requester was
 * entitled to see at request time — never more.
 */
export async function runReportWithScope(input: {
  reportKey: string
  db: TenantDb
  tenantId: string
  scope: ScopeFilter
  rawFilters: unknown
  locale: Locale
}): Promise<ReportResult> {
  return executeReport(input)
}
