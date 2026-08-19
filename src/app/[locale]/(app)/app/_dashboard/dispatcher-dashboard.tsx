import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import type { Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatMoney } from '@/i18n/translate'
import { tenantDb } from '@/db/tenant-db'
import { carrierDispatcherAssignments, documents } from '@/db/schema'
import { PageHeader } from '@/components/shell/page-header'
import { StatCard } from './stat-card'
import { activeLoadCount, monthToDateGrossMarginCents } from './finance-metrics'

const EXPIRING_SOON_WINDOW_DAYS = 30

export async function DispatcherDashboard({
  tenantId,
  userId,
  locale,
}: {
  tenantId: string
  userId: string
  locale: Locale
}) {
  const db = tenantDb(tenantId)

  const assignments = await db.findMany(carrierDispatcherAssignments, {
    where: and(eq(carrierDispatcherAssignments.dispatcherUserId, userId), isNull(carrierDispatcherAssignments.endDate)),
  })
  const carrierIds = [...new Set(assignments.map((a) => a.carrierId))]

  const now = new Date()
  const soonCutoff = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const documentsExpiring =
    carrierIds.length === 0
      ? 0
      : await db.count(
          documents,
          and(
            eq(documents.ownerType, 'carrier'),
            inArray(documents.ownerId, carrierIds),
            gte(documents.expirationDate, now),
            lte(documents.expirationDate, soonCutoff),
          ),
        )

  const scope = {
    kind: 'assigned' as const,
    tenantId,
    carrierIds,
    truckIds: [] as string[],
    trailerIds: [] as string[],
    driverIds: [] as string[],
    dispatcherUserId: userId,
  }
  const [activeLoads, monthToDateMargin] = await Promise.all([
    activeLoadCount(db, scope),
    monthToDateGrossMarginCents(db, scope, now),
  ])

  const dictionary = await getDictionary(locale, ['settings', 'common'])
  const t = createTranslator(dictionary, locale)

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.dashboard.dispatcher.title')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t('settings.dashboard.dispatcher.assignedCarriers')} value={carrierIds.length} />
        <StatCard
          label={t('settings.dashboard.dispatcher.documentsExpiring')}
          value={documentsExpiring}
          tone={documentsExpiring > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t('settings.dashboard.dispatcher.activeLoads')} value={activeLoads} />
        <StatCard
          label={t('settings.dashboard.dispatcher.monthToDateMargin')}
          value={monthToDateMargin === null ? '—' : formatMoney(monthToDateMargin, locale)}
        />
      </div>
    </div>
  )
}
