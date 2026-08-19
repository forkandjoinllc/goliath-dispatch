import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { driverCarrierRelationships, drivers, loadAssignments, trailers, trucks } from '@/db/schema'
import { defineReport, type ReportColumn, type ReportResult } from '../types'
import { resourceScope } from '../scope'

const filterSchema = z.object({
  range: z.object({
    preset: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  }),
  resourceType: z.enum(['truck', 'trailer', 'driver']).default('truck'),
})

export type EquipmentUtilizationFilters = z.infer<typeof filterSchema>

const COLUMNS: ReportColumn[] = [
  { key: 'unitLabel', labelKey: 'report.columns.unit', type: 'string' },
  { key: 'availableDays', labelKey: 'report.columns.availableDays', type: 'integer', numeric: true },
  { key: 'assignedDays', labelKey: 'report.columns.assignedDays', type: 'integer', numeric: true },
  { key: 'utilizationRate', labelKey: 'report.columns.utilizationRate', type: 'percent', numeric: true },
]

function overlapDays(rangeStart: Date, rangeEnd: Date, from: Date | null, to: Date | null): number {
  const start = from && from.getTime() > rangeStart.getTime() ? from : rangeStart
  const end = to && to.getTime() < rangeEnd.getTime() ? to : rangeEnd
  const ms = end.getTime() - start.getTime()
  return ms <= 0 ? 0 : ms / (24 * 60 * 60 * 1000)
}

export const equipmentDriverUtilizationReport = defineReport<EquipmentUtilizationFilters>({
  key: 'equipment_driver_utilization',
  titleKey: 'report.reports.equipmentUtilization.title',
  descriptionKey: 'report.reports.equipmentUtilization.description',
  requiredPermission: 'report:read',
  filterSchema,
  baseColumns: COLUMNS,
  supportsDateRange: true,
  async run({ db, scope, filters, range }): Promise<ReportResult> {
    if (scope.kind === 'own' && filters.resourceType !== 'driver') {
      return { columns: COLUMNS, rows: [], summary: null }
    }

    const availableDays = Math.max(1, (range.end.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000))

    let unitIds: string[]
    let unitLabels: Map<string, string>
    let assignmentColumn: 'truckId' | 'trailerId' | 'driverId'

    if (filters.resourceType === 'truck') {
      const clause = resourceScope(scope, trucks.carrierId, trucks.id, (s) => s.truckIds)
      if (clause === 'empty') return { columns: COLUMNS, rows: [], summary: null }
      const rows = await db.findMany(trucks, { where: clause })
      unitIds = rows.map((r) => r.id)
      unitLabels = new Map(rows.map((r) => [r.id, r.unitNumber]))
      assignmentColumn = 'truckId'
    } else if (filters.resourceType === 'trailer') {
      const clause = resourceScope(scope, trailers.carrierId, trailers.id, (s) => s.trailerIds)
      if (clause === 'empty') return { columns: COLUMNS, rows: [], summary: null }
      const rows = await db.findMany(trailers, { where: clause })
      unitIds = rows.map((r) => r.id)
      unitLabels = new Map(rows.map((r) => [r.id, r.unitNumber]))
      assignmentColumn = 'trailerId'
    } else {
      let driverIds: string[] | null = null
      if (scope.kind === 'carrier') {
        const relationships = await db.findMany(driverCarrierRelationships, {
          where: eq(driverCarrierRelationships.carrierId, scope.carrierId),
        })
        driverIds = relationships.map((r) => r.driverId)
      } else if (scope.kind === 'assigned') {
        driverIds = scope.driverIds
      } else if (scope.kind === 'own') {
        driverIds = scope.driverId ? [scope.driverId] : []
      }
      if (driverIds !== null && driverIds.length === 0) return { columns: COLUMNS, rows: [], summary: null }

      const rows = await db.findMany(drivers, {
        where: driverIds ? inArray(drivers.id, driverIds) : undefined,
      })
      unitIds = rows.map((r) => r.id)
      unitLabels = new Map(rows.map((r) => [r.id, `${r.firstName} ${r.lastName}`]))
      assignmentColumn = 'driverId'
    }

    if (unitIds.length === 0) return { columns: COLUMNS, rows: [], summary: null }

    const assignments = await db.findMany(loadAssignments, {
      where: and(
        inArray(loadAssignments[assignmentColumn], unitIds),
        eq(loadAssignments.resourceType, filters.resourceType),
      ),
    })

    const assignedDaysByUnit = new Map<string, number>()
    for (const assignment of assignments) {
      const unitId = assignment[assignmentColumn]
      if (!unitId) continue
      const days = overlapDays(range.start, range.end, assignment.committedFrom, assignment.committedTo ?? assignment.unassignedAt)
      assignedDaysByUnit.set(unitId, (assignedDaysByUnit.get(unitId) ?? 0) + days)
    }

    const rows = unitIds
      .map((id) => {
        const assignedDays = Math.min(availableDays, Math.round((assignedDaysByUnit.get(id) ?? 0) * 10) / 10)
        return {
          unitLabel: unitLabels.get(id) ?? id,
          availableDays: Math.round(availableDays),
          assignedDays,
          utilizationRate: Math.round((assignedDays / availableDays) * 10_000) / 100,
        }
      })
      .sort((a, b) => a.unitLabel.localeCompare(b.unitLabel))

    return {
      columns: COLUMNS,
      rows,
      summary: {
        avgUtilizationRate:
          rows.length === 0 ? 0 : Math.round((rows.reduce((s, r) => s + r.utilizationRate, 0) / rows.length) * 100) / 100,
      },
    }
  },
})
