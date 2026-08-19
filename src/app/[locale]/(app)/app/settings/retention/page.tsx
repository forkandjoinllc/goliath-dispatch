import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { can } from '@/lib/permissions'
import { getTenantPolicy } from '@/server/context'
import { getSettingsBundle } from '@/server/settings/queries'
import { retentionEligibilitySummary } from '@/server/retention/queries'
import { listActiveLegalHolds, listLegalHoldHistory } from '@/server/retention/legal-holds'
import { RETENTION_ENTITY_TYPES } from '@/server/retention/policy'
import { PageHeader } from '@/components/shell/page-header'
import { RetentionPolicyForm } from './_components/retention-policy-form'
import { EligibilityTable } from './_components/eligibility-table'
import { LegalHoldPanel } from './_components/legal-hold-panel'

export default async function RetentionSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('tenant:settings:read')
  const dictionary = await getDictionary(locale, ['settings', 'common'])
  const t = createTranslator(dictionary, locale)
  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canManage = can(ctx.actor, 'retention:manage', undefined, policy).allowed

  const { settings } = await getSettingsBundle(ctx.db)
  const window = {
    activeMonths: settings.operationalActiveMonths,
    purgeYearsAfterArchive: settings.operationalPurgeYearsAfterArchive,
    financialRetentionYears: settings.financialRetentionYears,
  }

  const [eligibility, activeHolds, holdHistory] = await Promise.all([
    retentionEligibilitySummary(ctx.db, new Date(), window),
    listActiveLegalHolds(ctx.db),
    listLegalHoldHistory(ctx.db),
  ])

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.retention.title')} description={t('settings.retention.description')} />

      <RetentionPolicyForm
        canUpdate={canManage}
        defaultValues={{
          operationalActiveMonths: settings.operationalActiveMonths,
          operationalPurgeYearsAfterArchive: settings.operationalPurgeYearsAfterArchive,
          financialRetentionYears: settings.financialRetentionYears,
        }}
      />

      <EligibilityTable rows={eligibility} />

      <LegalHoldPanel
        canManage={canManage}
        entityTypes={RETENTION_ENTITY_TYPES}
        activeHolds={activeHolds}
        history={holdHistory}
      />
    </div>
  )
}
