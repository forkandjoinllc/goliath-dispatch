import { and, eq, gte, lte, or } from 'drizzle-orm'
import type { Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatMoney } from '@/i18n/translate'
import { tenantDb } from '@/db/tenant-db'
import { carriers, documents } from '@/db/schema'
import { getCurrentSubscription } from '@/server/tenants/queries'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard, StatusBadgeForSubscription } from './stat-card'
import { activeLoadCount, monthToDateGrossMarginCents, openReceivablesCents, pendingSettlementPayoutCents } from './finance-metrics'

const EXPIRING_SOON_WINDOW_DAYS = 30

export async function AccountingDashboard({ tenantId, locale }: { tenantId: string; locale: Locale }) {
  const db = tenantDb(tenantId)
  const now = new Date()
  const soonCutoff = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const scope = { kind: 'tenant' as const, tenantId }

  const [documentsExpiring, pendingOnboarding, subscription, activeLoads, openReceivables, pendingSettlements, monthToDateMargin] =
    await Promise.all([
      db.count(documents, and(gte(documents.expirationDate, now), lte(documents.expirationDate, soonCutoff))),
      db.count(
        carriers,
        or(
          eq(carriers.onboardingStatus, 'submitted'),
          eq(carriers.onboardingStatus, 'under_review'),
          eq(carriers.onboardingStatus, 'corrections_required'),
        ),
      ),
      getCurrentSubscription(tenantId),
      activeLoadCount(db, scope),
      openReceivablesCents(db, scope, now),
      pendingSettlementPayoutCents(db, scope),
      monthToDateGrossMarginCents(db, scope, now),
    ])

  const dictionary = await getDictionary(locale, ['settings', 'common'])
  const t = createTranslator(dictionary, locale)

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.dashboard.accounting.title')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={t('settings.dashboard.accounting.documentsExpiring')}
          value={documentsExpiring}
          tone={documentsExpiring > 0 ? 'warning' : 'neutral'}
        />
        <StatCard label={t('settings.dashboard.accounting.pendingOnboarding')} value={pendingOnboarding} />
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-steel-500">
              {t('settings.dashboard.accounting.subscriptionStatus')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscription ? (
              <StatusBadgeForSubscription status={subscription.status} />
            ) : (
              <span className="text-sm text-steel-500">—</span>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('settings.dashboard.accounting.activeLoads')} value={activeLoads} />
        <StatCard label={t('settings.dashboard.accounting.openReceivables')} value={formatMoney(openReceivables, locale)} />
        <StatCard label={t('settings.dashboard.accounting.pendingSettlements')} value={formatMoney(pendingSettlements, locale)} />
        <StatCard
          label={t('settings.dashboard.accounting.monthToDateMargin')}
          value={monthToDateMargin === null ? '—' : formatMoney(monthToDateMargin, locale)}
        />
      </div>
    </div>
  )
}
