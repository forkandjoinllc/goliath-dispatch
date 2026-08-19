import 'server-only'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { carrierOnboardingEvents, carrierOnboardings, carriers } from '@/db/schema'
import { defineReport, type ReportColumn, type ReportResult } from '../types'
import { carrierColumnScope } from '../scope'

const filterSchema = z.object({})
export type OnboardingPipelineFilters = z.infer<typeof filterSchema>

const COLUMNS: ReportColumn[] = [
  { key: 'status', labelKey: 'report.columns.onboardingStatus', type: 'string' },
  { key: 'currentCount', labelKey: 'report.columns.currentCount', type: 'integer', numeric: true },
  { key: 'avgDaysInStatus', labelKey: 'report.columns.avgDaysInStatus', type: 'string', numeric: true },
]

const MS_PER_DAY = 24 * 60 * 60 * 1000

export const onboardingPipelineReport = defineReport<OnboardingPipelineFilters>({
  key: 'onboarding_pipeline',
  titleKey: 'report.reports.onboardingPipeline.title',
  descriptionKey: 'report.reports.onboardingPipeline.description',
  requiredPermission: 'report:read',
  filterSchema,
  baseColumns: COLUMNS,
  supportsDateRange: false,
  chart: { type: 'bar', xKey: 'status', series: [{ key: 'currentCount', labelKey: 'report.columns.currentCount' }] },
  async run({ db, scope }): Promise<ReportResult> {
    if (scope.kind === 'own') return { columns: COLUMNS, rows: [], summary: null }

    const carrierClause = carrierColumnScope(scope, carriers.id)
    if (carrierClause === 'empty') return { columns: COLUMNS, rows: [], summary: null }

    const ownedCarrierIds =
      carrierClause === undefined ? null : (await db.findMany(carriers, { where: carrierClause })).map((c) => c.id)

    const onboardings =
      ownedCarrierIds === null
        ? await db.findMany(carrierOnboardings, {})
        : ownedCarrierIds.length === 0
          ? []
          : await db.findMany(carrierOnboardings, { where: inArray(carrierOnboardings.carrierId, ownedCarrierIds) })

    if (onboardings.length === 0) return { columns: COLUMNS, rows: [], summary: emptySummary() }

    const events =
      onboardings.length > 0
        ? await db.findMany(carrierOnboardingEvents, {
            where: inArray(carrierOnboardingEvents.onboardingId, onboardings.map((o) => o.id)),
          })
        : []

    const eventsByOnboarding = new Map<string, typeof events>()
    for (const event of events) {
      const list = eventsByOnboarding.get(event.onboardingId) ?? []
      list.push(event)
      eventsByOnboarding.set(event.onboardingId, list)
    }

    const durationsByStatus = new Map<string, number[]>()
    for (const [, list] of eventsByOnboarding) {
      const sorted = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      for (let i = 0; i < sorted.length - 1; i++) {
        const status = sorted[i]!.toStatus
        const days = (sorted[i + 1]!.createdAt.getTime() - sorted[i]!.createdAt.getTime()) / MS_PER_DAY
        const list2 = durationsByStatus.get(status) ?? []
        list2.push(days)
        durationsByStatus.set(status, list2)
      }
    }

    const currentCounts = new Map<string, number>()
    for (const onboarding of onboardings) {
      currentCounts.set(onboarding.status, (currentCounts.get(onboarding.status) ?? 0) + 1)
    }

    const statuses = [...new Set([...currentCounts.keys(), ...durationsByStatus.keys()])]
    const rows = statuses
      .map((status) => {
        const durations = durationsByStatus.get(status) ?? []
        const avg = durations.length === 0 ? null : durations.reduce((a, b) => a + b, 0) / durations.length
        return {
          status,
          currentCount: currentCounts.get(status) ?? 0,
          avgDaysInStatus: avg === null ? '—' : avg.toFixed(1),
          _avgRaw: avg ?? -1,
        }
      })
      .sort((a, b) => a.status.localeCompare(b.status))

    const submittedCount = onboardings.filter((o) => o.submittedAt).length
    const approvedCount = onboardings.filter((o) => o.status === 'approved').length
    const bottleneck = [...rows].sort((a, b) => b._avgRaw - a._avgRaw)[0]

    const displayRows = rows.map(({ _avgRaw, ...rest }) => rest)

    return {
      columns: COLUMNS,
      rows: displayRows,
      summary: {
        conversionRatePercent: submittedCount === 0 ? 0 : Math.round((approvedCount / submittedCount) * 10_000) / 100,
        bottleneckStatus: bottleneck && bottleneck._avgRaw >= 0 ? bottleneck.status : null,
      },
    }
  },
})

function emptySummary() {
  return { conversionRatePercent: 0, bottleneckStatus: null }
}
