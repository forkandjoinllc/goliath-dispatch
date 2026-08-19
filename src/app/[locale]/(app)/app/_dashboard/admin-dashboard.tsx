import { and, eq, gte, isNull, lte, ne, or } from 'drizzle-orm'
import type { Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatMoney } from '@/i18n/translate'
import { tenantDb } from '@/db/tenant-db'
import { carriers, documents, userTenantMemberships } from '@/db/schema'
import { getCurrentSubscription } from '@/server/tenants/queries'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard, StatusBadgeForSubscription } from './stat-card'
import { activeLoadCount, monthToDateGrossMarginCents, openReceivablesCents, pendingSettlementPayoutCents } from './finance-metrics'

const EXPIRING_SOON_WINDOW_DAYS = 30

export async function AdminDashboard({ tenantId, locale }: { tenantId: string; locale: Locale }) {
  const db = tenantDb(tenantId)
  const now = new Date()
  const soonCutoff = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const scope = { kind: 'tenant' as const, tenantId }

  const [
    activeCarriers,
    pendingOnboarding,
    documentsExpiring,
    documentsExpired,
    teamMembers,
    subscription,
    activeLoads,
    openReceivables,
    pendingSettlements,
    monthToDateMargin,
  ] = await Promise.all([
    db.count(carriers, and(eq(carriers.onboardingStatus, 'approved'), isNull(carriers.suspendedAt))),
    db.count(
      carriers,
      or(
        eq(carriers.onboardingStatus, 'submitted'),
        eq(carriers.onboardingStatus, 'under_review'),
        eq(carriers.onboardingStatus, 'corrections_required'),
      ),
    ),
    db.count(documents, and(gte(documents.expirationDate, now), lte(documents.expirationDate, soonCutoff))),
    db.count(documents, lte(documents.expirationDate, now)),
    db.count(
      userTenantMemberships,
      and(eq(userTenantMemberships.status, 'active'), ne(userTenantMemberships.role, 'carrier'), ne(userTenantMemberships.role, 'driver')),
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
      <PageHeader title={t('settings.dashboard.admin.title')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t('settings.dashboard.admin.activeCarriers')} value={activeCarriers} />
        <StatCard label={t('settings.dashboard.admin.pendingOnboarding')} value={pendingOnboarding} />
        <StatCard label={t('settings.dashboard.admin.teamMembers')} value={teamMembers} />
        <StatCard
          label={t('settings.dashboard.admin.documentsExpiring')}
          value={documentsExpiring}
          tone={documentsExpiring > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label={t('settings.dashboard.admin.documentsExpired')}
          value={documentsExpired}
          tone={documentsExpired > 0 ? 'danger' : 'neutral'}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-steel-500">
              {t('settings.dashboard.admin.subscriptionStatus')}
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
        <StatCard label={t('settings.dashboard.admin.activeLoads')} value={activeLoads} />
        <StatCard label={t('settings.dashboard.admin.openReceivables')} value={formatMoney(openReceivables, locale)} />
        <StatCard label={t('settings.dashboard.admin.pendingSettlements')} value={formatMoney(pendingSettlements, locale)} />
        <StatCard
          label={t('settings.dashboard.admin.monthToDateMargin')}
          value={monthToDateMargin === null ? '—' : formatMoney(monthToDateMargin, locale)}
        />
      </div>
    </div>
  )
}
