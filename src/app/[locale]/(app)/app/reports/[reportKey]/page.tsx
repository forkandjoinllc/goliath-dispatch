import { notFound } from 'next/navigation'
import { and, desc, eq } from 'drizzle-orm'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { getReport } from '@/server/reports/registry'
import { runReportForActor } from '@/server/reports/runner'
import { reportFilterFields } from '@/server/reports/filter-fields'
import { exportJobs } from '@/db/schema'
import { PageHeader } from '@/components/shell/page-header'
import { ReportTable } from './_components/report-table'
import { ReportFilterBar } from './_components/report-filter-bar'
import { ExportPanel } from './_components/export-panel'

interface PageProps {
  params: Promise<{ locale: string; reportKey: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

export default async function ReportDetailPage({ params, searchParams }: PageProps) {
  const { locale, reportKey } = await params
  if (!isLocale(locale)) notFound()

  const definition = getReport(reportKey)
  if (!definition) notFound()

  const ctx = await loadFor(definition.requiredPermission)
  const dictionary = await getDictionary(locale, ['report', 'common'])
  const t = createTranslator(dictionary, locale)
  const policy = await getTenantPolicy(ctx.actor.tenantId)

  const query = await searchParams
  const rawFilters: Record<string, unknown> = {}
  if (definition.supportsDateRange) {
    rawFilters.range = { preset: query.preset, start: query.start, end: query.end }
  }
  const fields = reportFilterFields(definition)
  for (const field of fields) {
    if (query[field.key]) rawFilters[field.key] = query[field.key]
  }

  const result = await runReportForActor({
    reportKey,
    actor: ctx.actor,
    policy,
    db: ctx.db,
    rawFilters,
    locale,
  })

  const isPrivileged = ctx.actor.role === 'admin' || ctx.actor.isPlatformSuperAdmin
  const recentJobs = await ctx.db.findMany(exportJobs, {
    where: isPrivileged
      ? eq(exportJobs.reportKey, reportKey)
      : and(eq(exportJobs.reportKey, reportKey), eq(exportJobs.requestedByUserId, ctx.actor.userId))!,
    orderBy: desc(exportJobs.createdAt),
    limit: 10,
  })

  const basePath = `/${locale}/app/reports/${reportKey}`
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value) values[key] = value
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t(definition.titleKey)}
        description={definition.descriptionKey ? t(definition.descriptionKey) : undefined}
      />

      <ReportFilterBar
        basePath={basePath}
        supportsDateRange={definition.supportsDateRange}
        fields={fields.map((f) => ({ key: f.key, kind: f.kind, options: f.options }))}
        values={values}
      />

      <ReportTable
        columns={result.columns}
        rows={result.rows}
        summary={result.summary}
        chart={definition.chart}
        caption={t(definition.titleKey)}
      />

      <ExportPanel
        reportKey={reportKey}
        filters={rawFilters}
        initialJobs={recentJobs.map((job) => ({
          id: job.id,
          format: job.format,
          status: job.status as 'queued' | 'running' | 'succeeded' | 'failed',
          createdAt: job.createdAt,
          rowCount: job.rowCount,
          errorMessage: job.errorMessage,
        }))}
      />
    </div>
  )
}
