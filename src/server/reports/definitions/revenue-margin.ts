import 'server-only'
import { and, gte, inArray, isNotNull, lte, or } from 'drizzle-orm'
import { z } from 'zod'
import { carriers, customers, financialSnapshots, loads } from '@/db/schema'
import { defineReport, type ReportColumn, type ReportResult } from '../types'
import { loadsScope } from '../scope'
import { resolveUserNames } from '../users'

const filterSchema = z.object({
  range: z.object({
    preset: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  }),
  groupBy: z.enum(['period', 'customer', 'carrier', 'dispatcher']).default('period'),
  carrierId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
})

export type RevenueMarginFilters = z.infer<typeof filterSchema>

const TENANT_COLUMNS: ReportColumn[] = [
  { key: 'dimension', labelKey: 'report.columns.dimension', type: 'string' },
  { key: 'loadCount', labelKey: 'report.columns.loadCount', type: 'integer', numeric: true },
  { key: 'customerChargeCents', labelKey: 'report.columns.customerCharge', type: 'currency', numeric: true },
  { key: 'carrierGrossRateCents', labelKey: 'report.columns.carrierGrossRate', type: 'currency', numeric: true },
  { key: 'grossMarginCents', labelKey: 'report.columns.grossMargin', type: 'currency', numeric: true },
  { key: 'marginPercent', labelKey: 'report.columns.marginPercent', type: 'percent', numeric: true },
  {
    key: 'dispatcherCommissionAmountCents',
    labelKey: 'report.columns.dispatcherCommission',
    type: 'currency',
    numeric: true,
  },
]

/** A carrier must never see tenant margin or the customer's charge. */
const CARRIER_COLUMNS: ReportColumn[] = [
  { key: 'dimension', labelKey: 'report.columns.dimension', type: 'string' },
  { key: 'loadCount', labelKey: 'report.columns.loadCount', type: 'integer', numeric: true },
  { key: 'carrierGrossRateCents', labelKey: 'report.columns.carrierGrossRate', type: 'currency', numeric: true },
]

function periodKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export const revenueMarginReport = defineReport<RevenueMarginFilters>({
  key: 'revenue_margin',
  titleKey: 'report.reports.revenueMargin.title',
  descriptionKey: 'report.reports.revenueMargin.description',
  requiredPermission: 'report:read',
  filterSchema,
  baseColumns: TENANT_COLUMNS,
  supportsDateRange: true,
  chart: {
    type: 'bar',
    xKey: 'dimension',
    series: [
      { key: 'customerChargeCents', labelKey: 'report.columns.customerCharge' },
      { key: 'grossMarginCents', labelKey: 'report.columns.grossMargin' },
    ],
  },
  async run({ db, scope, filters, range }): Promise<ReportResult> {
    const isCarrier = scope.kind === 'carrier'
    const columns = isCarrier ? CARRIER_COLUMNS : TENANT_COLUMNS

    const dateColumn = loads.actualDeliveryAt
    const scoped = loadsScope(scope, { carrierId: loads.carrierId, dispatcherUserId: loads.dispatcherUserId })
    if (scoped === 'empty') return { columns, rows: [], summary: null }

    const clauses = [
      or(
        and(isNotNull(dateColumn), gte(dateColumn, range.start), lte(dateColumn, range.end)),
        and(isNotNull(loads.plannedPickupAt), gte(loads.plannedPickupAt, range.start), lte(loads.plannedPickupAt, range.end)),
      )!,
    ]
    if (scoped) clauses.push(scoped)
    if (filters.carrierId) clauses.push(inArray(loads.carrierId, [filters.carrierId]))
    if (filters.customerId) clauses.push(inArray(loads.customerId, [filters.customerId]))

    const matchingLoads = await db.findMany(loads, { where: and(...clauses) })
    if (matchingLoads.length === 0) return { columns, rows: [], summary: emptySummary(isCarrier) }

    const loadIds = matchingLoads.map((l) => l.id)
    const snapshots = await db.findMany(financialSnapshots, { where: inArray(financialSnapshots.loadId, loadIds) })
    const latestByLoad = new Map<string, (typeof snapshots)[number]>()
    for (const snap of snapshots) {
      const current = latestByLoad.get(snap.loadId)
      if (!current || snap.version > current.version) latestByLoad.set(snap.loadId, snap)
    }

    const [customerRows, carrierRows, dispatcherName] = await Promise.all([
      db.findMany(customers, { where: inArray(customers.id, [...new Set(matchingLoads.map((l) => l.customerId))]) }),
      db.findMany(carriers, {
        where: inArray(carriers.id, [...new Set(matchingLoads.map((l) => l.carrierId).filter((v): v is string => !!v))]),
      }),
      resolveUserNames(db, matchingLoads.map((l) => l.dispatcherUserId).filter((v): v is string => !!v)),
    ])
    const customerName = new Map(customerRows.map((c) => [c.id, c.companyName]))
    const carrierName = new Map(carrierRows.map((c) => [c.id, c.legalName]))

    interface Bucket {
      loadCount: number
      customerChargeCents: number
      carrierGrossRateCents: number
      grossMarginCents: number
      dispatcherCommissionAmountCents: number
    }
    const buckets = new Map<string, Bucket>()
    const emptyBucket = (): Bucket => ({
      loadCount: 0,
      customerChargeCents: 0,
      carrierGrossRateCents: 0,
      grossMarginCents: 0,
      dispatcherCommissionAmountCents: 0,
    })

    for (const load of matchingLoads) {
      const snapshot = latestByLoad.get(load.id)
      if (!snapshot) continue

      let dimension: string
      switch (filters.groupBy) {
        case 'customer':
          dimension = customerName.get(load.customerId) ?? load.customerId
          break
        case 'carrier':
          dimension = (load.carrierId && carrierName.get(load.carrierId)) ?? 'report.values.unassigned'
          break
        case 'dispatcher':
          dimension = (load.dispatcherUserId && dispatcherName.get(load.dispatcherUserId)) ?? 'report.values.unassigned'
          break
        case 'period':
        default:
          dimension = periodKey(load.actualDeliveryAt ?? load.plannedPickupAt ?? range.start)
      }

      const bucket = buckets.get(dimension) ?? emptyBucket()
      bucket.loadCount += 1
      bucket.customerChargeCents += snapshot.customerChargeCents
      bucket.carrierGrossRateCents += snapshot.carrierGrossRateCents
      bucket.grossMarginCents += snapshot.grossMarginCents
      bucket.dispatcherCommissionAmountCents += snapshot.dispatcherCommissionAmountCents
      buckets.set(dimension, bucket)
    }

    const rows = [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dimension, bucket]) => {
        const full = {
          dimension,
          loadCount: bucket.loadCount,
          customerChargeCents: bucket.customerChargeCents,
          carrierGrossRateCents: bucket.carrierGrossRateCents,
          grossMarginCents: bucket.grossMarginCents,
          marginPercent:
            bucket.customerChargeCents === 0
              ? 0
              : Math.round((bucket.grossMarginCents / bucket.customerChargeCents) * 10_000) / 100,
          dispatcherCommissionAmountCents: bucket.dispatcherCommissionAmountCents,
        }
        return isCarrier ? pick(full, ['dimension', 'loadCount', 'carrierGrossRateCents']) : full
      })

    return { columns, rows, summary: summarize(rows, isCarrier) }
  },
})

function pick<T extends Record<string, unknown>>(obj: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) out[key] = obj[key]
  return out
}

function emptySummary(isCarrier: boolean): Record<string, unknown> {
  return isCarrier
    ? { loadCount: 0, carrierGrossRateCents: 0 }
    : { loadCount: 0, customerChargeCents: 0, carrierGrossRateCents: 0, grossMarginCents: 0 }
}

function summarize(rows: Array<Record<string, unknown>>, isCarrier: boolean): Record<string, unknown> {
  const totals = emptySummary(isCarrier) as Record<string, number>
  for (const row of rows) {
    for (const key of Object.keys(totals)) {
      totals[key] += Number(row[key] ?? 0)
    }
  }
  return totals
}
