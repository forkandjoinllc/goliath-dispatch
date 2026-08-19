import 'server-only'
import { and, gte, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'
import { carrierSettlements, carriers } from '@/db/schema'
import { defineReport, type ReportColumn, type ReportResult } from '../types'
import { carrierColumnScope } from '../scope'

const filterSchema = z.object({
  range: z.object({
    preset: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  }),
})

export type SettlementSummaryFilters = z.infer<typeof filterSchema>

const COLUMNS: ReportColumn[] = [
  { key: 'carrierName', labelKey: 'report.columns.carrierName', type: 'string' },
  { key: 'settlementNumber', labelKey: 'report.columns.settlementNumber', type: 'string' },
  { key: 'periodStart', labelKey: 'report.columns.periodStart', type: 'date' },
  { key: 'periodEnd', labelKey: 'report.columns.periodEnd', type: 'date' },
  { key: 'grossRateCents', labelKey: 'report.columns.grossRate', type: 'currency', numeric: true },
  { key: 'dispatchFeesCents', labelKey: 'report.columns.dispatchFees', type: 'currency', numeric: true },
  { key: 'deductionsCents', labelKey: 'report.columns.deductions', type: 'currency', numeric: true },
  { key: 'netAmountCents', labelKey: 'report.columns.netAmount', type: 'currency', numeric: true },
  { key: 'status', labelKey: 'report.columns.status', type: 'string' },
]

export const settlementSummaryReport = defineReport<SettlementSummaryFilters>({
  key: 'settlement_summary',
  titleKey: 'report.reports.settlementSummary.title',
  descriptionKey: 'report.reports.settlementSummary.description',
  requiredPermission: 'report:read',
  filterSchema,
  baseColumns: COLUMNS,
  supportsDateRange: true,
  async run({ db, scope, range }): Promise<ReportResult> {
    if (scope.kind === 'assigned' || scope.kind === 'own') {
      return { columns: COLUMNS, rows: [], summary: null }
    }
    const scoped = carrierColumnScope(scope, carrierSettlements.carrierId)
    if (scoped === 'empty') return { columns: COLUMNS, rows: [], summary: null }

    const clauses = [gte(carrierSettlements.periodEnd, range.start), lte(carrierSettlements.periodStart, range.end)]
    if (scoped) clauses.push(scoped)

    const settlements = await db.findMany(carrierSettlements, { where: and(...clauses) })
    if (settlements.length === 0) return { columns: COLUMNS, rows: [], summary: { netAmountCents: 0 } }

    const carrierRows = await db.findMany(carriers, {
      where: inArray(carriers.id, [...new Set(settlements.map((s) => s.carrierId))]),
    })
    const carrierName = new Map(carrierRows.map((c) => [c.id, c.legalName]))

    const rows = settlements
      .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())
      .map((s) => ({
        carrierName: carrierName.get(s.carrierId) ?? s.carrierId,
        settlementNumber: s.settlementNumber,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        grossRateCents: s.grossRateCents,
        dispatchFeesCents: s.dispatchFeesCents,
        deductionsCents: s.deductionsCents,
        netAmountCents: s.netAmountCents,
        status: s.status,
      }))

    return {
      columns: COLUMNS,
      rows,
      summary: { netAmountCents: rows.reduce((sum, r) => sum + r.netAmountCents, 0) },
    }
  },
})
