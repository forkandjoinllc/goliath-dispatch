import { notFound } from 'next/navigation'
import Link from 'next/link'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatDateTime } from '@/i18n/translate'
import { requireActor } from '@/server/context'
import { authorize } from '@/lib/permissions'
import { listTenantsForPlatform } from '@/server/platform/tenants'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  active: 'success',
  suspended: 'danger',
  provisioning: 'neutral',
  trialing: 'warning',
  past_due: 'warning',
  cancelled: 'danger',
}

export default async function PlatformTenantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const actor = await requireActor()
  authorize(actor, 'platform:tenant:read')
  const dictionary = await getDictionary(locale, ['platform', 'common'])
  const t = createTranslator(dictionary, locale)

  const rows = await listTenantsForPlatform()

  return (
    <div className="space-y-6">
      <PageHeader title={t('platform.tenants.title')} description={t('platform.tenants.description')} />

      <div className="space-y-2">
        {rows.map(({ tenant, plan, subscriptionStatus, userCount, carrierCount, lastActivityAt }) => (
          <Link key={tenant.id} href={`/${locale}/app/platform/tenants/${tenant.id}`}>
            <Card className="transition-colors hover:border-navy-400">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-semibold text-carbon">{tenant.displayName}</p>
                  <p className="text-xs text-steel-500">{tenant.slug}</p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-steel-600">
                  <Badge tone={STATUS_TONE[tenant.status] ?? 'neutral'}>{t(`platform.tenants.status.${tenant.status}`)}</Badge>
                  <span>{plan ? plan.nameEn : t('platform.tenants.noPlan')}</span>
                  {subscriptionStatus ? <Badge tone="navy">{t(`platform.tenants.subscriptionStatus.${subscriptionStatus}`)}</Badge> : null}
                  <span>{t('platform.tenants.userCount', { count: userCount })}</span>
                  <span>{t('platform.tenants.carrierCount', { count: carrierCount })}</span>
                  <span>{lastActivityAt ? formatDateTime(lastActivityAt, locale, 'UTC') : t('platform.tenants.noActivity')}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
