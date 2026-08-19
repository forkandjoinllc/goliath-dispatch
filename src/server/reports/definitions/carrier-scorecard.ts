import 'server-only'
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { carriers, documents, financialSnapshots, loads } from '@/db/schema'
import { defineReport, type ReportColumn, type ReportResult } from '../types'
import { carrierColumnScope, loadsScope } from '../scope'

const filterSchema = z.object({
  range: z.object({
    preset: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  }),
})

export type CarrierScorecardFilters = z.infer<typeof filterSchema>

const TENANT_COLUMNS: ReportColumn[] = [
  { key: 'carrierName', labelKey: 'report.columns.carrierName', type: 'string' },
  { key: 'loadCount', labelKey: 'report.columns.loadCount', type: 'integer', numeric: true },
  { key: 'revenueCents', labelKey: 'report.columns.carrierGrossRate', type: 'currency', numeric: true },
  { key: 'marginCents', labelKey: 'report.columns.grossMargin', type: 'currency', numeric: true },
  { key: 'onTimeRate', labelKey: 'report.columns.onTimeDeliveryRate', type: 'percent', numeric: true },
  { key: 'documentComplianceRate', labelKey: 'report.columns.documentCompliance', type: 'percent', numeric: true },
  { key: 'verificationStatus', labelKey: 'report.columns.verificationStatus', type: 'string' },
]

const CARRIER_SCOPE_COLUMNS: ReportColumn[] = [
  { key: 'carrierName', labelKey: 'report.columns.carrierName', type: 'string' },
  { key: 'loadCount', labelKey: 'report.columns.loadCount', type: 'integer', numeric: true },
  { key: 'onTimeRate', labelKey: 'report.columns.onTimeDeliveryRate', type: 'percent', numeric: true },
  { key: 'documentComplianceRate', labelKey: 'report.columns.documentCompliance', type: 'percent', numeric: true },
  { key: 'verificationStatus', labelKey: 'report.columns.verificationStatus', type: 'string' },
]

export const carrierScorecardReport = defineReport<CarrierScorecardFilters>({
  key: 'carrier_scorecard',
  titleKey: 'report.reports.carrierScorecard.title',
  descriptionKey: 'report.reports.carrierScorecard.description',
  requiredPermission: 'report:read',
  filterSchema,
  baseColumns: TENANT_COLUMNS,
  supportsDateRange: true,
  async run({ db, scope, range }): Promise<ReportResult> {
    const isCarrier = scope.kind === 'carrier'
    const columns = isCarrier ? CARRIER_SCOPE_COLUMNS : TENANT_COLUMNS

    const carrierClause = carrierColumnScope(scope, carriers.id)
    if (carrierClause === 'empty') return { columns, rows: [], summary: null }

    const targetCarriers = await db.findMany(carriers, { where: carrierClause })
    if (targetCarriers.length === 0) return { columns, rows: [], summary: null }
    const carrierIds = targetCarriers.map((c) => c.id)

    const loadsScoped = loadsScope(scope, { carrierId: loads.carrierId, dispatcherUserId: loads.dispatcherUserId })
    const loadClauses = [
      inArray(loads.carrierId, carrierIds),
      isNotNull(loads.plannedPickupAt),
      gte(loads.plannedPickupAt, range.start),
      lte(loads.plannedPickupAt, range.end),
    ]
    if (loadsScoped && loadsScoped !== 'empty') loadClauses.push(loadsScoped)
    const periodLoads = loadsScoped === 'empty' ? [] : await db.findMany(loads, { where: and(...loadClauses) })

    const snapshots =
      periodLoads.length > 0
        ? await db.findMany(financialSnapshots, { where: inArray(financialSnapshots.loadId, periodLoads.map((l) => l.id)) })
        : []
    const latestByLoad = new Map<string, (typeof snapshots)[number]>()
    for (const snap of snapshots) {
      const current = latestByLoad.get(snap.loadId)
      if (!current || snap.version > current.version) latestByLoad.set(snap.loadId, snap)
    }

    const requiredDocs = await db.findMany(documents, {
      where: and(eq(documents.ownerType, 'carrier'), inArray(documents.ownerId, carrierIds), eq(documents.isRequired, true)),
    })
    const now = new Date()

    const rows = targetCarriers
      .map((carrier) => {
        const carrierLoads = periodLoads.filter((l) => l.carrierId === carrier.id)
        let onTimeDeliveries = 0
        let deliveriesWithActual = 0
        let revenueCents = 0
        let marginCents = 0
        for (const load of carrierLoads) {
          if (load.actualDeliveryAt && load.plannedDeliveryAt) {
            deliveriesWithActual += 1
            if (load.actualDeliveryAt.getTime() <= load.plannedDeliveryAt.getTime()) onTimeDeliveries += 1
          }
          const snapshot = latestByLoad.get(load.id)
          if (snapshot) {
            revenueCents += snapshot.carrierGrossRateCents
            marginCents += snapshot.grossMarginCents
          }
        }

        const carrierDocs = requiredDocs.filter((d) => d.ownerId === carrier.id)
        const compliant = carrierDocs.filter(
          (d) => d.reviewStatus === 'approved' && (!d.expirationDate || d.expirationDate.getTime() > now.getTime()),
        )
        const documentComplianceRate =
          carrierDocs.length === 0 ? 100 : Math.round((compliant.length / carrierDocs.length) * 10_000) / 100

        const full = {
          carrierName: carrier.legalName,
          loadCount: carrierLoads.length,
          revenueCents,
          marginCents,
          onTimeRate: deliveriesWithActual === 0 ? 0 : Math.round((onTimeDeliveries / deliveriesWithActual) * 10_000) / 100,
          documentComplianceRate,
          verificationStatus: carrier.fmcsaStatus,
        }
        return isCarrier
          ? {
              carrierName: full.carrierName,
              loadCount: full.loadCount,
              onTimeRate: full.onTimeRate,
              documentComplianceRate: full.documentComplianceRate,
              verificationStatus: full.verificationStatus,
            }
          : full
      })
      .sort((a, b) => a.carrierName.localeCompare(b.carrierName))

    return { columns, rows, summary: { carrierCount: rows.length } }
  },
})
