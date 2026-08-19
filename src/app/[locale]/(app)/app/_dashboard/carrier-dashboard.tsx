import { and, eq, gte, lte } from 'drizzle-orm'
import type { Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatMoney } from '@/i18n/translate'
import { tenantDb } from '@/db/tenant-db'
import { carriers, documents } from '@/db/schema'
import { PageHeader } from '@/components/shell/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { StatCard } from './stat-card'
import { activeLoadCount, openReceivablesCents, pendingSettlementPayoutCents } from './finance-metrics'

const EXPIRING_SOON_WINDOW_DAYS = 30

export async function CarrierPortalDashboard({
  tenantId,
  carrierId,
  locale,
}: {
  tenantId: string
  carrierId: string | null
  locale: Locale
}) {
  const dictionary = await getDictionary(locale, ['settings', 'common'])
  const t = createTranslator(dictionary, locale)

  if (!carrierId) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('settings.dashboard.carrierPortal.title')} />
        <EmptyState title={t('common.states.empty')} description={t('common.states.emptyHint')} />
      </div>
    )
  }

  const db = tenantDb(tenantId)
  const now = new Date()
  const soonCutoff = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const scope = { kind: 'carrier' as const, tenantId, carrierId }

  const [carrier, documentsExpiring, activeLoads, openReceivables, pendingSettlements] = await Promise.all([
    db.findById(carriers, carrierId),
    db.count(
      documents,
      and(
        eq(documents.ownerType, 'carrier'),
        eq(documents.ownerId, carrierId),
        gte(documents.expirationDate, now),
        lte(documents.expirationDate, soonCutoff),
      ),
    ),
    activeLoadCount(db, scope),
    openReceivablesCents(db, scope, now),
    pendingSettlementPayoutCents(db, scope),
  ])

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.dashboard.carrierPortal.title')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-steel-500">
              {t('settings.dashboard.carrierPortal.onboardingStatus')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {carrier ? <Badge tone="navy">{carrier.onboardingStatus}</Badge> : <span className="text-sm text-steel-500">—</span>}
          </CardContent>
        </Card>
        <StatCard
          label={t('settings.dashboard.carrierPortal.documentsExpiring')}
          value={documentsExpiring}
          tone={documentsExpiring > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t('settings.dashboard.carrierPortal.activeLoads')} value={activeLoads} />
        <StatCard label={t('settings.dashboard.carrierPortal.amountOwedToUs')} value={formatMoney(openReceivables, locale)} />
        <StatCard label={t('settings.dashboard.carrierPortal.amountOwedToYou')} value={formatMoney(pendingSettlements, locale)} />
      </div>
    </div>
  )
}
