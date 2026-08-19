import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatDateTime, formatNumber } from '@/i18n/translate'
import { requireActor } from '@/server/context'
import { authorize } from '@/lib/permissions'
import { tenantsByStatus, jobQueueHealth, webhookHealth, storageUsage } from '@/server/platform/health'
import { PageHeader } from '@/components/shell/page-header'
import { StatCard } from '@/components/data/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex += 1
  } while (value >= 1024 && unitIndex < units.length - 1)
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

export default async function PlatformHealthPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const actor = await requireActor()
  authorize(actor, 'platform:health:read')
  const dictionary = await getDictionary(locale, ['platform', 'common'])
  const t = createTranslator(dictionary, locale)

  const [byStatus, queue, webhooks, storage] = await Promise.all([
    tenantsByStatus(),
    jobQueueHealth(),
    webhookHealth(),
    storageUsage(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader title={t('platform.health.title')} description={t('platform.health.description')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('platform.health.queued')} value={formatNumber(queue.queued, locale)} />
        <StatCard label={t('platform.health.running')} value={formatNumber(queue.running, locale)} />
        <StatCard label={t('platform.health.failed')} value={formatNumber(queue.failed, locale)} />
        <StatCard label={t('platform.health.deadLetter')} value={formatNumber(queue.deadLetter, locale)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('platform.health.tenantsByStatus')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {byStatus.map((row) => (
            <Badge key={row.status} tone="navy">
              {t(`platform.tenants.status.${row.status}`)}: {formatNumber(row.count, locale)}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('platform.health.jobQueueTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-steel-700">
            <p>
              {t('platform.health.oldestQueued')}:{' '}
              {queue.oldestQueuedAt ? formatDateTime(queue.oldestQueuedAt, locale, 'UTC') : t('platform.health.none')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('platform.health.webhooksTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-steel-700">
            <p>
              {t('platform.health.webhooksReceived')}: {formatNumber(webhooks.received, locale)}
            </p>
            <p>
              {t('platform.health.webhooksProcessed')}: {formatNumber(webhooks.processed, locale)}
            </p>
            <p>
              {t('platform.health.webhooksFailed')}: {formatNumber(webhooks.failed, locale)}
            </p>
            <p>
              {t('platform.health.avgLag')}:{' '}
              {webhooks.avgProcessingLagSeconds != null
                ? t('platform.health.avgLagSeconds', { seconds: webhooks.avgProcessingLagSeconds })
                : t('platform.health.none')}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('platform.health.storageTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t('platform.health.documentStorage')} value={formatBytes(storage.documentBytes)} />
          <StatCard label={t('platform.health.mediaStorage')} value={formatBytes(storage.mediaBytes)} />
          <StatCard label={t('platform.health.totalStorage')} value={formatBytes(storage.totalBytes)} />
        </CardContent>
      </Card>
    </div>
  )
}
