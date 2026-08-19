import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { requireActor } from '@/server/context'
import { authorize, can } from '@/lib/permissions'
import { listAllPlans } from '@/server/platform/plans'
import { PageHeader } from '@/components/shell/page-header'
import { PlansList } from './_components/plans-list'

export default async function PlatformPlansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const actor = await requireActor()
  authorize(actor, 'platform:plan:read')
  const dictionary = await getDictionary(locale, ['platform', 'common'])
  const t = createTranslator(dictionary, locale)
  const canManage = can(actor, 'platform:plan:manage').allowed

  const plans = await listAllPlans()

  return (
    <div className="space-y-6">
      <PageHeader title={t('platform.plans.title')} description={t('platform.plans.description')} />
      <PlansList canManage={canManage} plans={plans} />
    </div>
  )
}
