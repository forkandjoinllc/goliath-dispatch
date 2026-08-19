import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { listCarriers, carrierComplianceSummary } from '@/server/carriers/queries'
import { onboardingStatusEnum } from '@/db/schema/_shared'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { CarrierList, type CarrierListRow } from './_components/carrier-list'
import { primaryDispatchersFor } from './_lib/queries'

export default async function CarriersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ page?: string; pageSize?: string; search?: string; onboardingStatus?: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const query = await searchParams

  const ctx = await loadFor('carrier:read')
  const dictionary = await getDictionary(locale, ['carrier', 'onboarding', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const decision = can(ctx.actor, 'carrier:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, decision.scope!)
  const canCreate = can(ctx.actor, 'carrier:create', undefined, policy).allowed

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25))
  const search = query.search ?? ''
  const onboardingStatus = query.onboardingStatus ?? ''

  const result = await listCarriers(ctx.db, scope, {
    search: search || undefined,
    onboardingStatus: (onboardingStatus || undefined) as never,
    pagination: { page, pageSize },
  })

  const carrierIds = result.carriers.map((c) => c.id)
  const [dispatchers, complianceByCarrier] = await Promise.all([
    primaryDispatchersFor(ctx.db, carrierIds),
    Promise.all(result.carriers.map((c) => carrierComplianceSummary(ctx.db, c.id))),
  ])

  const rows: CarrierListRow[] = result.carriers.map((carrier, index) => {
    const compliance = complianceByCarrier[index]
    const complianceState = compliance.blocking.length > 0 ? 'blocked' : compliance.warnings.length > 0 ? 'warning' : 'clear'
    return {
      carrier,
      dispatcherName: dispatchers.get(carrier.id)?.dispatcherName ?? null,
      complianceState,
    }
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('carrier.list.title')}
        primaryAction={
          canCreate ? (
            <Button asChild>
              <Link href={`/${locale}/app/carriers/new`}>{t('carrier.actions.create')}</Link>
            </Button>
          ) : undefined
        }
      />
      <CarrierList
        locale={locale}
        rows={rows}
        total={result.total}
        page={page}
        pageSize={pageSize}
        search={search}
        onboardingStatus={onboardingStatus}
        onboardingStatuses={onboardingStatusEnum.enumValues}
      />
    </div>
  )
}
