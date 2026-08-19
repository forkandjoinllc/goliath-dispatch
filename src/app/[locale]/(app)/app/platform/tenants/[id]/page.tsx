import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatDateTime } from '@/i18n/translate'
import { requireActor } from '@/server/context'
import { authorize, can } from '@/lib/permissions'
import { getTenantForPlatform } from '@/server/platform/tenants'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TenantActionsPanel } from './_components/tenant-actions-panel'

export default async function PlatformTenantDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const actor = await requireActor()
  authorize(actor, 'platform:tenant:read')
  const dictionary = await getDictionary(locale, ['platform', 'common'])
  const t = createTranslator(dictionary, locale)

  const tenant = await getTenantForPlatform(id)
  if (!tenant) notFound()

  const canSuspend = can(actor, 'platform:tenant:suspend').allowed
  const canSupportAccess = can(actor, 'platform:tenant:support_access').allowed

  return (
    <div className="space-y-6">
      <PageHeader
        title={tenant.displayName}
        description={tenant.slug}
        status={<Badge tone={tenant.status === 'suspended' ? 'danger' : 'success'}>{t(`platform.tenants.status.${tenant.status}`)}</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('platform.tenants.detailTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-steel-500">{t('platform.tenants.legalName')}</p>
            <p className="text-carbon">{tenant.legalName}</p>
          </div>
          <div>
            <p className="text-xs text-steel-500">{t('platform.tenants.customDomain')}</p>
            <p className="text-carbon">{tenant.customDomain ?? t('platform.tenants.noCustomDomain')}</p>
          </div>
          <div>
            <p className="text-xs text-steel-500">{t('platform.tenants.provisionedAt')}</p>
            <p className="text-carbon">{tenant.provisionedAt ? formatDateTime(tenant.provisionedAt, locale, 'UTC') : '—'}</p>
          </div>
          {tenant.status === 'suspended' ? (
            <div>
              <p className="text-xs text-steel-500">{t('platform.tenants.suspensionReason')}</p>
              <p className="text-carbon">{tenant.suspensionReason}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <TenantActionsPanel
        tenantId={tenant.id}
        tenantName={tenant.displayName}
        status={tenant.status}
        canSuspend={canSuspend}
        canSupportAccess={canSupportAccess}
      />
    </div>
  )
}
