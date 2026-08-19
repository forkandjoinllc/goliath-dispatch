import 'server-only'
import { and, desc, eq, isNotNull, isNull, lt, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { retentionJobs, type RetentionJob } from '@/db/schema'
import type { TenantDb } from '@/db/tenant-db'
import { classifyEntity, DEFAULT_RETENTION_WINDOW, RETENTION_ENTITY_TYPES, type RetentionWindow } from './policy'

/**
 * Read-side of retention: what is eligible for archival or purge right now,
 * what is currently held, and the history of jobs that ran. The job handler
 * that actually archives/purges lives under `src/jobs/**` (another agent);
 * this module is the shared source of truth for "what would it do" so the
 * admin screen and the job agree.
 */

export interface RetentionEligibilitySummary {
  entityType: string
  classification: 'operational' | 'financial'
  totalCount: number
  heldCount: number
  archiveEligibleCount: number
  purgeEligibleCount: number
}

interface RetentionColumns {
  createdAt: PgColumn
  legalHold?: PgColumn
  archivedAt?: PgColumn
}

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now.getTime())
  d.setMonth(d.getMonth() - months)
  return d
}

export async function retentionEligibilitySummary(
  db: TenantDb,
  now: Date = new Date(),
  window: RetentionWindow = DEFAULT_RETENTION_WINDOW,
): Promise<RetentionEligibilitySummary[]> {
  const results: RetentionEligibilitySummary[] = []

  for (const entityType of RETENTION_ENTITY_TYPES) {
    const info = classifyEntity(entityType)
    if (!info) continue
    const table = info.table as unknown as PgTable & RetentionColumns

    const totalCount = await db.count(table as never)
    const heldCount = table.legalHold ? await db.count(table as never, eq(table.legalHold, true)) : 0

    let archiveEligibleCount = 0
    let purgeEligibleCount = 0

    if (!info.supportsArchival) {
      results.push({ entityType, classification: info.classification, totalCount, heldCount, archiveEligibleCount, purgeEligibleCount })
      continue
    }

    const notHeld: SQL | undefined = table.legalHold ? eq(table.legalHold, false) : undefined

    if (info.classification === 'operational') {
      const activeCutoff = monthsAgo(now, window.activeMonths)
      const archivedAtColumn = table.archivedAt
      archiveEligibleCount = await db.count(
        table as never,
        and(archivedAtColumn ? isNull(archivedAtColumn) : undefined, notHeld, lt(table.createdAt, activeCutoff)),
      )

      if (archivedAtColumn) {
        const purgeCutoff = monthsAgo(now, window.purgeYearsAfterArchive * 12)
        purgeEligibleCount = await db.count(
          table as never,
          and(notHeld, isNotNull(archivedAtColumn), lt(archivedAtColumn, purgeCutoff)),
        )
      }
    } else {
      const financialCutoff = monthsAgo(now, window.financialRetentionYears * 12)
      purgeEligibleCount = await db.count(table as never, and(notHeld, lt(table.createdAt, financialCutoff)))
    }

    results.push({ entityType, classification: info.classification, totalCount, heldCount, archiveEligibleCount, purgeEligibleCount })
  }

  return results
}

export async function listRetentionJobHistory(db: TenantDb): Promise<RetentionJob[]> {
  return db.findMany(retentionJobs, { orderBy: desc(retentionJobs.createdAt) })
}
