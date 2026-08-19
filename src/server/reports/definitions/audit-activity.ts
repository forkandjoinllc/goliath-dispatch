import 'server-only'
import { and, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import { auditEvents } from '@/db/schema'
import { defineReport, type ReportColumn, type ReportResult } from '../types'

const filterSchema = z.object({
  range: z.object({
    preset: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  }),
})

export type AuditActivityFilters = z.infer<typeof filterSchema>

const COLUMNS: ReportColumn[] = [
  { key: 'actorEmail', labelKey: 'report.columns.actor', type: 'string' },
  { key: 'actionType', labelKey: 'report.columns.actionType', type: 'string' },
  { key: 'eventCount', labelKey: 'report.columns.eventCount', type: 'integer', numeric: true },
]

/**
 * `audit:read` is only ever granted at 'tenant' (Admin, Accounting) or
 * 'platform' (Super Admin) scope — no role holds it at 'assigned', 'carrier'
 * or 'own' — so this report's `requiredPermission` gates it out for every
 * other role before `run()` is even reached.
 */
export const auditActivityReport = defineReport<AuditActivityFilters>({
  key: 'audit_activity',
  titleKey: 'report.reports.auditActivity.title',
  descriptionKey: 'report.reports.auditActivity.description',
  requiredPermission: 'audit:read',
  filterSchema,
  baseColumns: COLUMNS,
  supportsDateRange: true,
  chart: { type: 'bar', xKey: 'actorEmail', series: [{ key: 'eventCount', labelKey: 'report.columns.eventCount' }] },
  async run({ db, scope, range }): Promise<ReportResult> {
    if (scope.kind !== 'tenant' && scope.kind !== 'platform') {
      return { columns: COLUMNS, rows: [], summary: null }
    }

    const events = await db.findMany(auditEvents, {
      where: and(gte(auditEvents.occurredAt, range.start), lte(auditEvents.occurredAt, range.end)),
    })

    const counts = new Map<string, number>()
    for (const event of events) {
      const actorEmail = event.actorEmail ?? 'report.values.system'
      const actionType = event.action.split('.')[0] ?? event.action
      const key = `${actorEmail}::${actionType}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    const rows = [...counts.entries()]
      .map(([key, eventCount]) => {
        const [actorEmail, actionType] = key.split('::')
        return { actorEmail, actionType, eventCount }
      })
      .sort((a, b) => b.eventCount - a.eventCount)

    return { columns: COLUMNS, rows, summary: { totalEvents: events.length } }
  },
})
