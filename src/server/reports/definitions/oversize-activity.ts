import 'server-only'
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { escorts, loads, permits, routeStates, routes } from '@/db/schema'
import { defineReport, type ReportColumn, type ReportResult } from '../types'
import { loadsScope } from '../scope'

const filterSchema = z.object({
  range: z.object({
    preset: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  }),
})

export type OversizeActivityFilters = z.infer<typeof filterSchema>

const COLUMNS: ReportColumn[] = [
  { key: 'loadNumber', labelKey: 'report.columns.loadNumber', type: 'string' },
  { key: 'statesTraversed', labelKey: 'report.columns.statesTraversed', type: 'integer', numeric: true },
  { key: 'permitsIssued', labelKey: 'report.columns.permitsIssued', type: 'integer', numeric: true },
  { key: 'permitCostCents', labelKey: 'report.columns.permitCost', type: 'currency', numeric: true },
  { key: 'escortCostCents', labelKey: 'report.columns.escortCost', type: 'currency', numeric: true },
]

export const oversizeActivityReport = defineReport<OversizeActivityFilters>({
  key: 'oversize_activity',
  titleKey: 'report.reports.oversizeActivity.title',
  descriptionKey: 'report.reports.oversizeActivity.description',
  requiredPermission: 'report:read',
  filterSchema,
  baseColumns: COLUMNS,
  supportsDateRange: true,
  async run({ db, scope, range }): Promise<ReportResult> {
    const scoped = loadsScope(scope, { carrierId: loads.carrierId, dispatcherUserId: loads.dispatcherUserId })
    if (scoped === 'empty') return { columns: COLUMNS, rows: [], summary: null }

    const clauses = [eq(loads.isOversize, true), isNotNull(loads.plannedPickupAt), gte(loads.plannedPickupAt, range.start), lte(loads.plannedPickupAt, range.end)]
    if (scoped) clauses.push(scoped)

    const oversizeLoads = await db.findMany(loads, { where: and(...clauses) })
    if (oversizeLoads.length === 0) return { columns: COLUMNS, rows: [], summary: emptySummary() }

    const loadIds = oversizeLoads.map((l) => l.id)
    const [permitRows, escortRows, routeRows] = await Promise.all([
      db.findMany(permits, { where: inArray(permits.loadId, loadIds) }),
      db.findMany(escorts, { where: inArray(escorts.loadId, loadIds) }),
      db.findMany(routes, { where: and(inArray(routes.loadId, loadIds), eq(routes.isCurrent, true)) }),
    ])
    const routeIds = routeRows.map((r) => r.id)
    const stateRows = routeIds.length > 0 ? await db.findMany(routeStates, { where: inArray(routeStates.routeId, routeIds) }) : []
    const routeIdByLoad = new Map(routeRows.map((r) => [r.loadId, r.id]))
    const stateCountByRoute = new Map<string, number>()
    for (const state of stateRows) {
      stateCountByRoute.set(state.routeId, (stateCountByRoute.get(state.routeId) ?? 0) + 1)
    }

    const rows = oversizeLoads
      .map((load) => {
        const loadPermits = permitRows.filter((p) => p.loadId === load.id)
        const loadEscorts = escortRows.filter((e) => e.loadId === load.id)
        const routeId = routeIdByLoad.get(load.id)
        return {
          loadNumber: load.loadNumber,
          statesTraversed: routeId ? (stateCountByRoute.get(routeId) ?? 0) : 0,
          permitsIssued: loadPermits.filter((p) => p.status === 'issued').length,
          permitCostCents: loadPermits.reduce((sum, p) => sum + p.costCents, 0),
          escortCostCents: loadEscorts.reduce((sum, e) => sum + e.costCents, 0),
        }
      })
      .sort((a, b) => a.loadNumber.localeCompare(b.loadNumber))

    return {
      columns: COLUMNS,
      rows,
      summary: {
        permitsIssued: rows.reduce((s, r) => s + r.permitsIssued, 0),
        permitCostCents: rows.reduce((s, r) => s + r.permitCostCents, 0),
        escortCostCents: rows.reduce((s, r) => s + r.escortCostCents, 0),
      },
    }
  },
})

function emptySummary() {
  return { permitsIssued: 0, permitCostCents: 0, escortCostCents: 0 }
}
