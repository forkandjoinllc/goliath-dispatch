import 'server-only'
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { carriers, documents, type Carrier, type Document } from '@/db/schema'
import { defineReport, type ReportColumn, type ReportResult } from '../types'
import { carrierColumnScope } from '../scope'

const filterSchema = z.object({
  withinDays: z.number().int().min(1).max(365).default(30),
  ownerType: z.enum(['carrier', 'truck', 'trailer', 'driver']).optional(),
})

export type DocumentComplianceFilters = z.infer<typeof filterSchema>

const COLUMNS: ReportColumn[] = [
  { key: 'ownerType', labelKey: 'report.columns.ownerType', type: 'string' },
  { key: 'ownerLabel', labelKey: 'report.columns.ownerLabel', type: 'string' },
  { key: 'documentType', labelKey: 'report.columns.documentType', type: 'string' },
  { key: 'expirationDate', labelKey: 'report.columns.expirationDate', type: 'date' },
  { key: 'daysRemaining', labelKey: 'report.columns.daysRemaining', type: 'integer', numeric: true },
  { key: 'status', labelKey: 'report.columns.complianceStatus', type: 'string' },
]

const MS_PER_DAY = 24 * 60 * 60 * 1000

function buildRows(docs: Document[], carrierRows: Carrier[], now: Date) {
  const carrierName = new Map(carrierRows.map((c) => [c.id, c.legalName]))
  return docs
    .map((d) => {
      const daysRemaining = Math.ceil((d.expirationDate!.getTime() - now.getTime()) / MS_PER_DAY)
      return {
        ownerType: d.ownerType,
        ownerLabel: d.ownerType === 'carrier' ? (carrierName.get(d.ownerId) ?? d.ownerId) : d.ownerId,
        documentType: d.documentType,
        expirationDate: d.expirationDate,
        daysRemaining,
        status: daysRemaining < 0 ? 'report.values.expired' : 'report.values.expiring',
      }
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining)
}

export const documentComplianceReport = defineReport<DocumentComplianceFilters>({
  key: 'document_compliance',
  titleKey: 'report.reports.documentCompliance.title',
  descriptionKey: 'report.reports.documentCompliance.description',
  requiredPermission: 'report:read',
  filterSchema,
  baseColumns: COLUMNS,
  supportsDateRange: false,
  async run({ db, scope, filters }): Promise<ReportResult> {
    const now = new Date()
    const cutoff = new Date(now.getTime() + filters.withinDays * MS_PER_DAY)

    const clauses = [isNotNull(documents.expirationDate), lte(documents.expirationDate, cutoff)]
    if (filters.ownerType) clauses.push(eq(documents.ownerType, filters.ownerType))

    // Row-level scope enforcement: a carrier or a dispatcher's assigned
    // carriers may only see their own carrier-owned documents in this
    // report. Equipment/driver document scoping for those roles is
    // intentionally out of scope here — they read those from the
    // equipment/driver detail screens, which apply the full assignment graph.
    if (scope.kind === 'carrier' || scope.kind === 'assigned') {
      const carrierClause = carrierColumnScope(scope, carriers.id)
      if (carrierClause === 'empty') return { columns: COLUMNS, rows: [], summary: null }
      const ownedCarriers = await db.findMany(carriers, { where: carrierClause })
      const ids = new Set(ownedCarriers.map((c) => c.id))
      const allDocs = await db.findMany(documents, { where: and(...clauses, eq(documents.ownerType, 'carrier')) })
      const filtered = allDocs.filter((d) => ids.has(d.ownerId))
      const rows = buildRows(filtered, ownedCarriers, now)
      return { columns: COLUMNS, rows, summary: summaryOf(rows) }
    }

    if (scope.kind === 'own') return { columns: COLUMNS, rows: [], summary: null }

    const allDocs = await db.findMany(documents, { where: and(...clauses) })
    const carrierIds = [...new Set(allDocs.filter((d) => d.ownerType === 'carrier').map((d) => d.ownerId))]
    const carrierRows = carrierIds.length > 0 ? await db.findMany(carriers, { where: inArray(carriers.id, carrierIds) }) : []
    const rows = buildRows(allDocs, carrierRows, now)
    return { columns: COLUMNS, rows, summary: summaryOf(rows) }
  },
})

function summaryOf(rows: Array<{ daysRemaining: number }>) {
  return {
    expiredCount: rows.filter((r) => r.daysRemaining < 0).length,
    expiringCount: rows.filter((r) => r.daysRemaining >= 0).length,
  }
}
