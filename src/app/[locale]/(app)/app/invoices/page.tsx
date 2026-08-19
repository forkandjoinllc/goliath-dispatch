import { notFound } from 'next/navigation'
import { inArray } from 'drizzle-orm'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { carriers } from '@/db/schema'
import { listInvoices, receivablesAgingSummary, receivablesSummary } from '@/server/invoices/queries'
import { PageHeader } from '@/components/shell/page-header'
import { StatCard } from '@/components/data/stat-card'
import { formatMoney } from '@/i18n/translate'
import { InvoiceList } from './_components/invoice-list'
import { CreateInvoiceDialog } from './_components/create-invoice-dialog'

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ page?: string; pageSize?: string; status?: string; overdueOnly?: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const query = await searchParams

  const ctx = await loadFor('invoice:read')
  const dictionary = await getDictionary(locale, ['finance', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const decision = can(ctx.actor, 'invoice:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, decision.scope!)
  const canCreate = can(ctx.actor, 'invoice:create', undefined, policy).allowed

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25))
  const status = (query.status || undefined) as never
  const overdueOnly = query.overdueOnly === 'true'

  const [result, summary, aging] = await Promise.all([
    listInvoices(ctx.db, scope, { status, overdueOnly, pagination: { page, pageSize } }),
    receivablesSummary(ctx.db, scope),
    receivablesAgingSummary(ctx.db, scope),
  ])

  const carrierIds = [...new Set(result.invoices.map((i) => i.carrierId))]
  const carrierRows =
    carrierIds.length > 0 ? await ctx.db.findMany(carriers, { where: inArray(carriers.id, carrierIds) }) : []
  const carrierNameById = Object.fromEntries(carrierRows.map((c) => [c.id, c.legalName]))

  const i18nLocale = locale as 'en' | 'es'

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('finance.invoice.title')}
        primaryAction={canCreate ? <CreateInvoiceDialog locale={locale} /> : undefined}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label={t('finance.invoice.receivables.outstanding')} value={formatMoney(summary.outstandingCents, i18nLocale)} />
        <StatCard label={t('finance.invoice.receivables.overdue')} value={formatMoney(summary.overdueCents, i18nLocale)} />
        <StatCard label={t('finance.invoice.receivables.sentCount')} value={String(summary.sentCount)} />
        <StatCard label={t('finance.invoice.receivables.overdueCount')} value={String(summary.overdueCount)} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label={t('finance.invoice.aging.current')} value={formatMoney(aging.current, i18nLocale)} />
        <StatCard label={t('finance.invoice.aging.0-30')} value={formatMoney(aging['0-30'], i18nLocale)} />
        <StatCard label={t('finance.invoice.aging.31-60')} value={formatMoney(aging['31-60'], i18nLocale)} />
        <StatCard label={t('finance.invoice.aging.61-90')} value={formatMoney(aging['61-90'], i18nLocale)} />
        <StatCard label={t('finance.invoice.aging.90+')} value={formatMoney(aging['90+'], i18nLocale)} />
      </div>

      <InvoiceList
        locale={locale}
        rows={result.invoices}
        total={result.total}
        page={page}
        pageSize={pageSize}
        status={query.status ?? ''}
        overdueOnly={overdueOnly}
        carrierNameById={carrierNameById}
      />
    </div>
  )
}
