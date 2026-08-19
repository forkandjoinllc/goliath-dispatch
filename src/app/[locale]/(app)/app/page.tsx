import { notFound, redirect } from 'next/navigation'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { getActor } from '@/server/context'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/feedback'
import { AdminDashboard } from './_dashboard/admin-dashboard'
import { AccountingDashboard } from './_dashboard/accounting-dashboard'
import { DispatcherDashboard } from './_dashboard/dispatcher-dashboard'
import { CarrierPortalDashboard } from './_dashboard/carrier-dashboard'

/**
 * The dashboard router. Every role sees real numbers, scoped exactly the way
 * `report:read`/`load:financials:read`/`invoice:read`/`settlement:read`
 * scope everything else: carriers, onboarding, documents, team and
 * subscription counts, plus active loads, open receivables, pending
 * settlement payouts and month-to-date gross margin (see
 * `_dashboard/finance-metrics.ts`) — a Carrier's dashboard never computes or
 * shows margin, matching the same structural rule the reports module
 * enforces.
 */
export default async function AppDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) notFound()
  const locale = rawLocale as Locale

  const actor = await getActor()
  if (!actor) redirect(`/${locale}/login`)

  const dictionary = await getDictionary(locale, ['settings', 'common'])
  const t = createTranslator(dictionary, locale)

  if (!actor.tenantId || !actor.role || actor.role === 'platform_super_admin') {
    return (
      <div className="space-y-6">
        <PageHeader title={t('settings.dashboard.admin.title')} />
        <EmptyState
          title={t('common.states.empty')}
          description={t('common.states.emptyHint')}
        />
      </div>
    )
  }

  switch (actor.role) {
    case 'admin':
      return <AdminDashboard tenantId={actor.tenantId} locale={locale} />
    case 'accounting':
      return <AccountingDashboard tenantId={actor.tenantId} locale={locale} />
    case 'dispatcher':
      return <DispatcherDashboard tenantId={actor.tenantId} userId={actor.userId} locale={locale} />
    case 'carrier':
    case 'driver':
      return (
        <CarrierPortalDashboard
          tenantId={actor.tenantId}
          carrierId={actor.carrierId}
          locale={locale}
        />
      )
    default:
      return (
        <div className="space-y-6">
          <PageHeader title={t('settings.dashboard.admin.title')} />
          <EmptyState title={t('common.states.empty')} description={t('common.states.emptyHint')} />
        </div>
      )
  }
}
