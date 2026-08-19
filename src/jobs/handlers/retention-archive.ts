import 'server-only'
import { z } from 'zod'
import { and, eq, isNotNull, isNull, lte, ne, or } from 'drizzle-orm'
import { tenantDb, type TenantDb } from '@/db/tenant-db'
import { documents, loads, retentionJobs, tenantSettings } from '@/db/schema'
import { logger } from '@/lib/logger'
import { defineJob, type JobContext } from '../registry'
import { listAllTenantIds } from '../tenants'

/**
 * Daily retention archival: moves operational records past the tenant's
 * active window (24 months by default, `tenantSettings.operationalActiveMonths`)
 * into the protected archive by setting `archivedAt` + `purgeEligibleAt`
 * (`operationalPurgeYearsAfterArchive` after that, 5 years by default).
 *
 * The entity registry below is intentionally representative rather than
 * exhaustive — `loads` and `documents` are the two highest-volume operational
 * tables with a clear "closed" date to key off, and match two of the
 * entries in `@/server/retention`'s `RETENTION_ENTITY_TYPES` (the
 * compliance module's own shared classification, built alongside this job).
 * Extending coverage to the rest of that registry (customers, carriers,
 * trucks, …) is future work: each addition needs its own "closed" date
 * decision and, for purge specifically, a check that deleting the row
 * doesn't collide with FK references from tables outside this registry —
 * this job deliberately does not attempt that generalization yet.
 *
 * Financial records — invoices and signature records — are excluded here on
 * purpose — see the table in `docs/architecture.md` §9: they have no
 * intermediate "archived" state, they go from active straight to
 * purge-eligible after 7 years. `retention-purge.ts` computes that
 * eligibility directly from each financial table's own date column; it is
 * never staged through this job.
 *
 * Legal hold: every retention-eligible table carries a denormalized
 * `legal_hold` boolean (`db/schema/_shared.ts`'s `retention` column spread),
 * kept in sync by `@/server/retention/legal-holds.ts`'s `applyLegalHold` /
 * `releaseLegalHold` (built by the platform-admin agent). This job trusts
 * that column directly — `eq(table.legalHold, false)` in every candidate
 * query — rather than re-deriving hold coverage from the `legal_holds` table
 * itself, which is exactly what that denormalization exists to avoid.
 */

const sweepSchema = z.object({}).strict()

interface SweepCounts {
  candidate: number
  processed: number
  skippedLegalHold: number
}

async function activeMonthsFor(db: TenantDb): Promise<number> {
  const settings = await db.findFirst(tenantSettings)
  return settings?.operationalActiveMonths ?? 24
}

async function purgeYearsAfterArchiveFor(db: TenantDb): Promise<number> {
  const settings = await db.findFirst(tenantSettings)
  return settings?.operationalPurgeYearsAfterArchive ?? 5
}

function monthsAgo(now: Date, months: number): Date {
  const cutoff = new Date(now)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
  return cutoff
}

function yearsFromNow(now: Date, years: number): Date {
  const next = new Date(now)
  next.setUTCFullYear(next.getUTCFullYear() + years)
  return next
}

async function recordSweep(
  db: TenantDb,
  entityType: string,
  cutoffAt: Date,
  counts: SweepCounts,
  errorMessage: string | null,
): Promise<void> {
  await db.insert(retentionJobs, {
    action: 'archive',
    entityType,
    status: errorMessage ? 'failed' : 'succeeded',
    cutoffAt,
    candidateCount: counts.candidate,
    processedCount: counts.processed,
    skippedLegalHoldCount: counts.skippedLegalHold,
    errorMessage,
    startedAt: new Date(),
    completedAt: new Date(),
  })
}

async function archiveLoads(db: TenantDb, cutoff: Date, now: Date, purgeEligibleAt: Date): Promise<SweepCounts> {
  const closedBeforeCutoff = or(
    and(isNotNull(loads.actualDeliveryAt), lte(loads.actualDeliveryAt, cutoff)),
    and(isNotNull(loads.cancelledAt), lte(loads.cancelledAt, cutoff)),
  )!

  const skippedLegalHold = await db.count(loads, and(isNull(loads.archivedAt), closedBeforeCutoff, eq(loads.legalHold, true))!)

  const updated = await db.updateWhere(
    loads,
    and(isNull(loads.archivedAt), closedBeforeCutoff, eq(loads.legalHold, false))!,
    { archivedAt: now, purgeEligibleAt },
  )
  const processed = updated.length

  return { candidate: processed + skippedLegalHold, processed, skippedLegalHold }
}

/** Excludes `documentType: 'invoice'` — that lineage follows the financial 7-year rule directly, never staged through here. */
async function archiveDocuments(db: TenantDb, cutoff: Date, now: Date, purgeEligibleAt: Date): Promise<SweepCounts> {
  const eligible = and(isNull(documents.archivedAt), lte(documents.createdAt, cutoff), ne(documents.documentType, 'invoice'))!

  const skippedLegalHold = await db.count(documents, and(eligible, eq(documents.legalHold, true))!)

  const updated = await db.updateWhere(documents, and(eligible, eq(documents.legalHold, false))!, {
    archivedAt: now,
    purgeEligibleAt,
  })
  const processed = updated.length

  return { candidate: processed + skippedLegalHold, processed, skippedLegalHold }
}

export async function runRetentionArchiveSweep(_payload: z.infer<typeof sweepSchema>, _ctx: JobContext): Promise<void> {
  const now = new Date()
  const tenantIds = await listAllTenantIds()

  for (const tenantId of tenantIds) {
    const db = tenantDb(tenantId)
    const activeMonths = await activeMonthsFor(db)
    const purgeYears = await purgeYearsAfterArchiveFor(db)
    const cutoff = monthsAgo(now, activeMonths)
    const purgeEligibleAt = yearsFromNow(now, purgeYears)

    // Entity type strings match `@/server/retention/policy.ts`'s
    // `RETENTION_ENTITY_TYPES` keys (the shared classification the
    // compliance dashboard reads), so a `retention_jobs` row here lines up
    // with that module's own `entityType` vocabulary.
    for (const [entityType, run] of [
      ['loads', archiveLoads] as const,
      ['documents', archiveDocuments] as const,
    ]) {
      try {
        const counts = await run(db, cutoff, now, purgeEligibleAt)
        await recordSweep(db, entityType, cutoff, counts, null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error'
        logger.error('retention-archive: sweep failed', { tenantId, entityType, error })
        await recordSweep(db, entityType, cutoff, { candidate: 0, processed: 0, skippedLegalHold: 0 }, message)
      }
    }
  }
}

defineJob('retention.archive_sweep', {
  schema: sweepSchema,
  handler: runRetentionArchiveSweep,
  defaultMaxAttempts: 3,
  description: 'Daily sweep: archives operational records past the active window, skipping anything under legal hold.',
})
