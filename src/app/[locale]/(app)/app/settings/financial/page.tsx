import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { can } from '@/lib/permissions'
import { getTenantPolicy } from '@/server/context'
import { getSettingsBundle } from '@/server/settings/queries'
import { PageHeader } from '@/components/shell/page-header'
import { FinancialForm } from './_components/financial-form'

export default async function FinancialSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('tenant:settings:read')
  const dictionary = await getDictionary(locale, ['settings', 'common'])
  const t = createTranslator(dictionary, locale)
  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canUpdate = can(ctx.actor, 'tenant:settings:update', undefined, policy).allowed

  const { settings } = await getSettingsBundle(ctx.db)

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.financial.title')} description={t('settings.financial.description')} />
      <FinancialForm
        canUpdate={canUpdate}
        defaultValues={{
          defaultCarrierDispatchFeeBps: settings.defaultCarrierDispatchFeeBps,
          defaultDispatcherCommissionBps: settings.defaultDispatcherCommissionBps,
          dispatcherCommissionBasis: settings.dispatcherCommissionBasis,
        }}
      />
    </div>
  )
}
