import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { can, scopeFilter } from '@/lib/permissions'
import { getTenantPolicy } from '@/server/context'
import { listLoads, listLoadsForViews, type LoadListFilters } from '@/server/loads/queries'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { parseLoadsFilters, LoadsFilterBar } from './_components/loads-filter-bar'
import { LoadsViewSwitcher } from './_components/loads-view-switcher'
import { LoadsTableView } from './_components/loads-table-view'
import { LoadsBoardView } from './_components/loads-board-view'
import { LoadsCalendarView } from './_components/loads-calendar-view'
import { LoadsTimelineView } from './_components/loads-timeline-view'
import { LoadsMapView } from './_components/loads-map-view'

export default async function LoadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const query = await searchParams

  const ctx = await loadFor('load:read')
  const dictionary = await getDictionary(locale, ['load', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const readDecision = can(ctx.actor, 'load:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, readDecision.scope!)
  const canCreate = can(ctx.actor, 'load:create', undefined, policy).allowed

  const filters = parseLoadsFilters(query)
  const listFilters: LoadListFilters = {
    status: filters.status.length > 0 ? filters.status : undefined,
    reference: filters.reference || undefined,
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
    oversizeOnly: filters.oversizeOnly || undefined,
    customerId: filters.customerId || undefined,
  }

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25))

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('load.title')}
        primaryAction={
          canCreate ? (
            <Link href={`/${locale}/app/loads/new`}>
              <Button>{t('load.new.title')}</Button>
            </Link>
          ) : undefined
        }
      />

      <LoadsFilterBar locale={locale} filters={filters} />
      <LoadsViewSwitcher locale={locale} filters={filters} />

      {filters.view === 'table' ? (
        <TableView ctx={ctx} scope={scope} locale={locale} listFilters={listFilters} page={page} pageSize={pageSize} />
      ) : null}
      {filters.view === 'board' ? <BoardView ctx={ctx} scope={scope} locale={locale} listFilters={listFilters} /> : null}
      {filters.view === 'calendar' ? <CalendarView ctx={ctx} scope={scope} locale={locale} listFilters={listFilters} /> : null}
      {filters.view === 'timeline' ? <TimelineView ctx={ctx} scope={scope} locale={locale} listFilters={listFilters} /> : null}
      {filters.view === 'map' ? <MapView ctx={ctx} scope={scope} locale={locale} listFilters={listFilters} /> : null}
    </div>
  )
}

type LoadPageContext = Awaited<ReturnType<typeof loadFor>>
type Scope = ReturnType<typeof scopeFilter>

async function TableView({
  ctx,
  scope,
  locale,
  listFilters,
  page,
  pageSize,
}: {
  ctx: LoadPageContext
  scope: Scope
  locale: string
  listFilters: LoadListFilters
  page: number
  pageSize: number
}) {
  const result = await listLoads(ctx.db, scope, listFilters, { field: 'createdAt', direction: 'desc' }, { page, pageSize })
  return <LoadsTableView locale={locale} rows={result.rows} total={result.total} page={page} pageSize={pageSize} />
}

async function BoardView({ ctx, scope, locale, listFilters }: { ctx: LoadPageContext; scope: Scope; locale: string; listFilters: LoadListFilters }) {
  const result = await listLoadsForViews(ctx.db, scope, listFilters)
  return <LoadsBoardView locale={locale} rows={result.rows} />
}

async function CalendarView({ ctx, scope, locale, listFilters }: { ctx: LoadPageContext; scope: Scope; locale: string; listFilters: LoadListFilters }) {
  const result = await listLoadsForViews(ctx.db, scope, listFilters)
  return <LoadsCalendarView locale={locale} rows={result.rows} />
}

async function TimelineView({ ctx, scope, locale, listFilters }: { ctx: LoadPageContext; scope: Scope; locale: string; listFilters: LoadListFilters }) {
  const result = await listLoadsForViews(ctx.db, scope, listFilters)
  return <LoadsTimelineView locale={locale} rows={result.rows} stopsByLoadId={result.stopsByLoadId} />
}

async function MapView({ ctx, scope, locale, listFilters }: { ctx: LoadPageContext; scope: Scope; locale: string; listFilters: LoadListFilters }) {
  const result = await listLoadsForViews(ctx.db, scope, listFilters)
  return <LoadsMapView locale={locale} rows={result.rows} stopsByLoadId={result.stopsByLoadId} />
}
