import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { can } from '@/lib/permissions'
import { getTenantPolicy } from '@/server/context'
import { getSettingsBundle } from '@/server/settings/queries'
import { PageHeader } from '@/components/shell/page-header'
import { OperationalForm } from './_components/operational-form'

export default async function OperationalSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
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
      <PageHeader title={t('settings.operational.title')} description={t('settings.operational.description')} />
      <OperationalForm
        canUpdate={canUpdate}
        defaultValues={{
          documentExpirationWarningDays: settings.documentExpirationWarningDays,
          fmcsaReverificationDays: settings.fmcsaReverificationDays,
          allowDispatcherResourceAssignment: settings.allowDispatcherResourceAssignment,
          requireOversizeAdminValidation: settings.requireOversizeAdminValidation,
          loadNumberPrefix: settings.loadNumberPrefix,
          invoiceNumberPrefix: settings.invoiceNumberPrefix,
          defaultPaymentTermsDays: settings.defaultPaymentTermsDays,
          publicTrackingEnabled: settings.publicTrackingEnabled,
          publicTrackingTokenTtlHours: settings.publicTrackingTokenTtlHours,
        }}
      />
    </div>
  )
}
