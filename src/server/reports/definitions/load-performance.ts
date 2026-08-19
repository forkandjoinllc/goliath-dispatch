import 'server-only'
import { and, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { carriers, loadStops, loads } from '@/db/schema'
import { defineReport, type ReportColumn, type ReportResult } from '../types'
import { loadsScope } from '../scope'

const filterSchema = z.object({
  range: z.object({
    preset: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  }),
  groupBy: z.enum(['status', 'carrier']).default('status'),
  carrierId: z.string().uuid().optional(),
})

export type LoadPerformanceFilters = z.infer<typeof filterSchema>

const COLUMNS: ReportColumn[] = [
  { key: 'dimension', labelKey: 'report.columns.dimension', type: 'string' },
  { key: 'loadCount', labelKey: 'report.columns.loadCount', type: 'integer', numeric: true },
  { key: 'onTimePickupRate', labelKey: 'report.columns.onTimePickupRate', type: 'percent', numeric: true },
  { key: 'onTimeDeliveryRate', labelKey: 'report.columns.onTimeDeliveryRate', type: 'percent', numeric: true },
  { key: 'avgTransitDays', labelKey: 'report.columns.avgTransitDays', type: 'string', numeric: true },
  { key: 'totalDetentionMinutes', labelKey: 'report.columns.detentionMinutes', type: 'integer', numeric: true },
]

export const loadPerformanceReport = defineReport<LoadPerformanceFilters>({
  key: 'load_performance',
  titleKey: 'report.reports.loadPerformance.title',
  descriptionKey: 'report.reports.loadPerformance.description',
  requiredPermission: 'report:read',
  filterSchema,
  baseColumns: COLUMNS,
  supportsDateRange: true,
  chart: { type: 'bar', xKey: 'dimension', series: [{ key: 'loadCount', labelKey: 'report.columns.loadCount' }] },
  async run({ db, scope, filters, range }): Promise<ReportResult> {
    const scoped = loadsScope(scope, { carrierId: loads.carrierId, dispatcherUserId: loads.dispatcherUserId })
    if (scoped === 'empty') return { columns: COLUMNS, rows: [], summary: null }

    const clauses = [isNotNull(loads.plannedPickupAt), gte(loads.plannedPickupAt, range.start), lte(loads.plannedPickupAt, range.end)]
    if (scoped) clauses.push(scoped)
    if (filters.carrierId) clauses.push(inArray(loads.carrierId, [filters.carrierId]))

    const matchingLoads = await db.findMany(loads, { where: and(...clauses) })
    if (matchingLoads.length === 0) return { columns: COLUMNS, rows: [], summary: emptySummary() }

    const stops =
      matchingLoads.length > 0
        ? await db.findMany(loadStops, { where: inArray(loadStops.loadId, matchingLoads.map((l) => l.id)) })
        : []
    const detentionByLoad = new Map<string, number>()
    for (const stop of stops) {
      if (!stop.detentionMinutes) continue
      detentionByLoad.set(stop.loadId, (detentionByLoad.get(stop.loadId) ?? 0) + stop.detentionMinutes)
    }

    const carrierRows =
      filters.groupBy === 'carrier'
        ? await db.findMany(carriers, {
            where: inArray(carriers.id, [...new Set(matchingLoads.map((l) => l.carrierId).filter((v): v is string => !!v))]),
          })
        : []
    const carrierName = new Map(carrierRows.map((c) => [c.id, c.legalName]))

    interface Bucket {
      loadCount: number
      onTimePickups: number
      pickupsWithActual: number
      onTimeDeliveries: number
      deliveriesWithActual: number
      transitDaysTotal: number
      transitDaysCount: number
      detentionMinutes: number
    }
    const emptyBucket = (): Bucket => ({
      loadCount: 0,
      onTimePickups: 0,
      pickupsWithActual: 0,
      onTimeDeliveries: 0,
      deliveriesWithActual: 0,
      transitDaysTotal: 0,
      transitDaysCount: 0,
      detentionMinutes: 0,
    })
    const buckets = new Map<string, Bucket>()

    for (const load of matchingLoads) {
      const dimension =
        filters.groupBy === 'carrier'
          ? (load.carrierId && carrierName.get(load.carrierId)) ?? 'report.values.unassigned'
          : load.status

      const bucket = buckets.get(dimension) ?? emptyBucket()
      bucket.loadCount += 1

      if (load.actualPickupAt && load.plannedPickupAt) {
        bucket.pickupsWithActual += 1
        if (load.actualPickupAt.getTime() <= load.plannedPickupAt.getTime()) bucket.onTimePickups += 1
      }
      if (load.actualDeliveryAt && load.plannedDeliveryAt) {
        bucket.deliveriesWithActual += 1
        if (load.actualDeliveryAt.getTime() <= load.plannedDeliveryAt.getTime()) bucket.onTimeDeliveries += 1
      }
      if (load.actualPickupAt && load.actualDeliveryAt) {
        const days = (load.actualDeliveryAt.getTime() - load.actualPickupAt.getTime()) / (24 * 60 * 60 * 1000)
        bucket.transitDaysTotal += days
        bucket.transitDaysCount += 1
      }
      bucket.detentionMinutes += detentionByLoad.get(load.id) ?? 0

      buckets.set(dimension, bucket)
    }

    const rows = [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dimension, b]) => ({
        dimension,
        loadCount: b.loadCount,
        onTimePickupRate: rate(b.onTimePickups, b.pickupsWithActual),
        onTimeDeliveryRate: rate(b.onTimeDeliveries, b.deliveriesWithActual),
        avgTransitDays: b.transitDaysCount === 0 ? '—' : (b.transitDaysTotal / b.transitDaysCount).toFixed(1),
        totalDetentionMinutes: b.detentionMinutes,
      }))

    return { columns: COLUMNS, rows, summary: summarize(rows) }
  },
})

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100
}

function emptySummary() {
  return { loadCount: 0, totalDetentionMinutes: 0 }
}

function summarize(rows: Array<Record<string, unknown>>) {
  return {
    loadCount: rows.reduce((sum, r) => sum + Number(r.loadCount ?? 0), 0),
    totalDetentionMinutes: rows.reduce((sum, r) => sum + Number(r.totalDetentionMinutes ?? 0), 0),
  }
}
