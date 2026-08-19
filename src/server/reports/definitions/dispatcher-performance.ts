import 'server-only'
import { and, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { dispatcherCommissions, financialSnapshots, loads } from '@/db/schema'
import { defineReport, type ReportColumn, type ReportResult } from '../types'
import { dispatcherColumnScope } from '../scope'
import { resolveUserNames } from '../users'

const filterSchema = z.object({
  range: z.object({
    preset: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  }),
})

export type DispatcherPerformanceFilters = z.infer<typeof filterSchema>

const COLUMNS: ReportColumn[] = [
  { key: 'dispatcherName', labelKey: 'report.columns.dispatcherName', type: 'string' },
  { key: 'loadCount', labelKey: 'report.columns.loadCount', type: 'integer', numeric: true },
  { key: 'revenueCents', labelKey: 'report.columns.carrierGrossRate', type: 'currency', numeric: true },
  { key: 'marginCents', labelKey: 'report.columns.grossMargin', type: 'currency', numeric: true },
  { key: 'commissionAccruedCents', labelKey: 'report.columns.commissionAccrued', type: 'currency', numeric: true },
  { key: 'commissionPaidCents', labelKey: 'report.columns.commissionPaid', type: 'currency', numeric: true },
]

/** Only `report:read` at 'tenant' or 'assigned' scope reaches this report — Accounting/Admin see every dispatcher, a Dispatcher sees only themself. */
export const dispatcherPerformanceReport = defineReport<DispatcherPerformanceFilters>({
  key: 'dispatcher_performance',
  titleKey: 'report.reports.dispatcherPerformance.title',
  descriptionKey: 'report.reports.dispatcherPerformance.description',
  requiredPermission: 'report:read',
  filterSchema,
  baseColumns: COLUMNS,
  supportsDateRange: true,
  async run({ db, scope, range }): Promise<ReportResult> {
    if (scope.kind === 'carrier' || scope.kind === 'own') return { columns: COLUMNS, rows: [], summary: null }

    const dispatcherClause = dispatcherColumnScope(scope, loads.dispatcherUserId)
    if (dispatcherClause === 'empty') return { columns: COLUMNS, rows: [], summary: null }

    const clauses = [isNotNull(loads.dispatcherUserId), isNotNull(loads.plannedPickupAt), gte(loads.plannedPickupAt, range.start), lte(loads.plannedPickupAt, range.end)]
    if (dispatcherClause) clauses.push(dispatcherClause)

    const periodLoads = await db.findMany(loads, { where: and(...clauses) })
    if (periodLoads.length === 0) return { columns: COLUMNS, rows: [], summary: summaryOf([]) }

    const loadIds = periodLoads.map((l) => l.id)
    const [snapshots, commissions, dispatcherNames] = await Promise.all([
      db.findMany(financialSnapshots, { where: inArray(financialSnapshots.loadId, loadIds) }),
      db.findMany(dispatcherCommissions, { where: inArray(dispatcherCommissions.loadId, loadIds) }),
      resolveUserNames(db, periodLoads.map((l) => l.dispatcherUserId).filter((v): v is string => !!v)),
    ])
    const latestByLoad = new Map<string, (typeof snapshots)[number]>()
    for (const snap of snapshots) {
      const current = latestByLoad.get(snap.loadId)
      if (!current || snap.version > current.version) latestByLoad.set(snap.loadId, snap)
    }

    interface Bucket {
      loadCount: number
      revenueCents: number
      marginCents: number
      commissionAccruedCents: number
      commissionPaidCents: number
    }
    const buckets = new Map<string, Bucket>()
    const emptyBucket = (): Bucket => ({
      loadCount: 0,
      revenueCents: 0,
      marginCents: 0,
      commissionAccruedCents: 0,
      commissionPaidCents: 0,
    })

    for (const load of periodLoads) {
      if (!load.dispatcherUserId) continue
      const bucket = buckets.get(load.dispatcherUserId) ?? emptyBucket()
      bucket.loadCount += 1
      const snapshot = latestByLoad.get(load.id)
      if (snapshot) {
        bucket.revenueCents += snapshot.carrierGrossRateCents
        bucket.marginCents += snapshot.grossMarginCents
      }
      buckets.set(load.dispatcherUserId, bucket)
    }

    for (const commission of commissions) {
      const load = periodLoads.find((l) => l.id === commission.loadId)
      if (!load?.dispatcherUserId) continue
      const bucket = buckets.get(load.dispatcherUserId) ?? emptyBucket()
      if (commission.status === 'paid') bucket.commissionPaidCents += commission.amountCents
      else if (commission.status === 'accrued' || commission.status === 'approved') {
        bucket.commissionAccruedCents += commission.amountCents
      }
      buckets.set(load.dispatcherUserId, bucket)
    }

    const rows = [...buckets.entries()]
      .map(([userId, b]) => ({ dispatcherName: dispatcherNames.get(userId) ?? userId, ...b }))
      .sort((a, b) => a.dispatcherName.localeCompare(b.dispatcherName))

    return { columns: COLUMNS, rows, summary: summaryOf(rows) }
  },
})

function summaryOf(rows: Array<Record<string, unknown>>) {
  return {
    loadCount: rows.reduce((s, r) => s + Number(r.loadCount ?? 0), 0),
    revenueCents: rows.reduce((s, r) => s + Number(r.revenueCents ?? 0), 0),
    marginCents: rows.reduce((s, r) => s + Number(r.marginCents ?? 0), 0),
    commissionAccruedCents: rows.reduce((s, r) => s + Number(r.commissionAccruedCents ?? 0), 0),
    commissionPaidCents: rows.reduce((s, r) => s + Number(r.commissionPaidCents ?? 0), 0),
  }
}
