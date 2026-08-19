import 'server-only'
import { z } from 'zod'
import { receivablesAgingSummary, type AgingBucket } from '@/server/invoices/queries'
import { defineReport, type ReportColumn, type ReportResult } from '../types'

const filterSchema = z.object({
  asOf: z.string().optional(),
})

export type ReceivablesAgingFilters = z.infer<typeof filterSchema>

const COLUMNS: ReportColumn[] = [
  { key: 'bucket', labelKey: 'report.columns.agingBucket', type: 'string' },
  { key: 'totalCents', labelKey: 'report.columns.amount', type: 'currency', numeric: true },
]

const BUCKET_ORDER: AgingBucket[] = ['current', '0-30', '31-60', '61-90', '90+']

/**
 * Wraps `receivablesAgingSummary` (owned by the invoices module — read only,
 * not modified) so the aging bucket boundaries stay defined in exactly one
 * place.
 */
export const receivablesAgingReport = defineReport<ReceivablesAgingFilters>({
  key: 'receivables_aging',
  titleKey: 'report.reports.receivablesAging.title',
  descriptionKey: 'report.reports.receivablesAging.description',
  requiredPermission: 'report:read',
  filterSchema,
  baseColumns: COLUMNS,
  supportsDateRange: false,
  chart: { type: 'donut', xKey: 'bucket', series: [{ key: 'totalCents', labelKey: 'report.columns.amount' }] },
  async run({ db, scope, filters }): Promise<ReportResult> {
    if (scope.kind === 'assigned' || scope.kind === 'own') {
      // Dispatchers and drivers hold no invoice:read grant at any scope.
      return { columns: COLUMNS, rows: [], summary: null }
    }
    const asOf = filters.asOf ? new Date(filters.asOf) : new Date()
    const summary = await receivablesAgingSummary(db, scope, asOf)
    const rows = BUCKET_ORDER.map((bucket) => ({ bucket, totalCents: summary[bucket] }))
    const totalCents = BUCKET_ORDER.reduce((sum, bucket) => sum + summary[bucket], 0)
    return { columns: COLUMNS, rows, summary: { totalCents } }
  },
})
