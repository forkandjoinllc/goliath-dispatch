import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { can } from '@/lib/permissions'
import { getTenantPolicy } from '@/server/context'
import { listIntegrationConnections, type IntegrationCategory } from '@/server/tracking/integrations'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { PageHeader } from '@/components/shell/page-header'
import { IntegrationCard } from './_components/integration-card'

const CATEGORY_ORDER: IntegrationCategory[] = ['tracking', 'maps', 'tolls', 'fmcsa', 'ocr', 'email', 'sms', 'payments']

export default async function IntegrationsSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('tenant:integration:read')
  const dictionary = await getDictionary(locale, ['tracking', 'common', 'errors'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canManage = can(ctx.actor, 'tenant:integration:update', undefined, policy).allowed

  const connections = await listIntegrationConnections(ctx.db)
  const byCategory = new Map<IntegrationCategory, typeof connections>()
  for (const connection of connections) {
    const list = byCategory.get(connection.category) ?? []
    list.push(connection)
    byCategory.set(connection.category, list)
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('tracking.integrations.title')} description={t('tracking.integrations.description')} />

      {CATEGORY_ORDER.map((category) => {
        const rows = byCategory.get(category) ?? []
        if (rows.length === 0) return null
        return (
          <section key={category} className="space-y-3">
            <h2 className="text-lg font-bold text-carbon">{t(`tracking.integrations.categoryTitle.${category}`)}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {rows.map((connection) => (
                <IntegrationCard key={`${connection.category}:${connection.provider}`} connection={connection} canManage={canManage} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
