import 'server-only'
import { z } from 'zod'
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import { tenantDb, type TenantDb } from '@/db/tenant-db'
import { documents, invoices, loads, retentionJobs, tenantSettings } from '@/db/schema'
import { logger } from '@/lib/logger'
import { isProduction } from '@/lib/env'
import { recordAudit } from '@/lib/audit'
import { newId } from '@/lib/crypto'
import { classifyEntity } from '@/server/retention/policy'
import { defineJob, type JobContext } from '../registry'
import { listAllTenantIds } from '../tenants'

/**
 * Weekly permanent deletion — and, for `loads`, anonymization.
 *
 * Three independent sources of eligibility, matching `docs/architecture.md`
 * §9's retention table exactly:
 *
 *  1. Operational records `retention-archive.ts` already archived
 *     (`documents`), once `purgeEligibleAt` (archival + 5 years by default)
 *     has passed — a real `DELETE`.
 *  2. Financial-class records (`invoices` — "never before 7 years", no
 *     intermediate archived state) whose own age exceeds
 *     `tenantSettings.financialRetentionYears`, computed directly here
 *     rather than read from a persisted column, since they never pass
 *     through the archive step that would have written one — a real
 *     `DELETE`.
 *  3. Archived `loads` past the same `purgeEligibleAt` window as (1) — but
 *     *anonymized*, not deleted. See `@/server/retention/policy.ts`'s
 *     `PurgeStrategy` doc comment for the full reasoning: `load_status_history`
 *     and `financial_snapshots` are append-only children
 *     `drizzle/custom/0001_audit_immutability.sql` structurally forbids ever
 *     deleting, and both cascade-reference `loads.id`, so a real
 *     `DELETE FROM loads` can never succeed for any load that has gone
 *     through a status transition. `classifyEntity('loads').purgeStrategy`
 *     is the one place that decision is recorded; this handler reads it
 *     rather than re-deciding it locally, so the job and the policy module
 *     cannot drift.
 *
 * Entity type strings ('documents', 'invoices', 'loads') match
 * `@/server/retention/policy.ts`'s `RETENTION_ENTITY_TYPES` keys — the
 * compliance dashboard's shared classification, built alongside this job —
 * so a `retention_jobs` row here lines up with that module's vocabulary.
 * Coverage is deliberately a subset of that full registry: purging any of
 * the remaining tables generically would mean deleting rows other,
 * non-retention tables may still reference by foreign key, which needs a
 * per-entity cascade/ordering decision this job does not attempt yet.
 *
 * Legal hold: every one of these tables carries a denormalized `legal_hold`
 * boolean, kept in sync by `@/server/retention/legal-holds.ts`'s
 * `applyLegalHold` / `releaseLegalHold`. This job trusts that column
 * directly (`eq(table.legalHold, false)` in the delete/update predicate
 * itself, so a held row is structurally excluded from the candidate set, not
 * merely counted afterward) rather than re-deriving hold coverage from the
 * `legal_holds` table itself.
 *
 * The delete paths go only through `TenantDb.purge()`, which refuses to run
 * without the explicit `{ legalHoldChecked: true }` proof. The anonymize
 * path never calls `purge()` at all — it is a normal `updateWhere()`, since
 * nothing is being deleted — but follows the exact same audited sequence:
 * (a) find candidates, (b) write a `retention_jobs` row *before* touching
 * anything, (c) apply the change with a `where` clause that excludes held
 * rows, (d) update the same row with final counts. It is naturally
 * idempotent: redacting an already-redacted, already-soft-deleted load is a
 * no-op, and the `deletedAt IS NULL` clause in its candidate query means a
 * load is only ever selected — and only ever produces a `retention.purged`
 * audit event — once.
 *
 * `signature_records` (and `signature_audit_events`) are the one entity type
 * in the full registry with genuinely no purge path, by design: they are
 * executed legal instruments with a hash chain and integrity seal, and
 * `signature_records_guard` forbids their deletion unconditionally, with no
 * anonymize fallback — see `docs/architecture.md` §9. Shipping a purge
 * attempt that is guaranteed to fail (and log a failure) every single week
 * forever would be worse than not attempting it, so it is not implemented
 * here.
 *
 * PRODUCTION SAFETY: a purge is irreversible, so in `APP_ENV=production`
 * this refuses to do anything unless the job's own payload carries
 * `confirm: true`. The scheduled cron route never sets it — see
 * `src/app/api/cron/retention-purge/route.ts` — so a production purge only
 * ever runs when an operator deliberately re-enqueues/fires it with
 * confirmation (the CLI's `--job-type` flag plus a hand-built payload, or a
 * future admin action). This is logged loudly rather than thrown/retried:
 * retrying the identical payload can never gain confirmation on its own, so
 * failing the job repeatedly would just be weekly noise.
 */

const sweepSchema = z.object({ confirm: z.boolean().optional() }).strict()

interface PurgeCounts {
  candidate: number
  processed: number
  skippedLegalHold: number
}

async function financialRetentionYearsFor(db: TenantDb): Promise<number> {
  const settings = await db.findFirst(tenantSettings)
  return settings?.financialRetentionYears ?? 7
}

function yearsAgo(now: Date, years: number): Date {
  const cutoff = new Date(now)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years)
  return cutoff
}

/** Opens the `retention_jobs` row a purge (or anonymize) run is proved against, before anything is changed. */
async function openRetentionJob(
  db: TenantDb,
  entityType: string,
  cutoffAt: Date,
  candidateCount: number,
  action: 'purge' | 'anonymize' = 'purge',
): Promise<string> {
  const row = await db.insert(retentionJobs, {
    action,
    entityType,
    status: 'running',
    cutoffAt,
    candidateCount,
    startedAt: new Date(),
  })
  return row.id
}

async function closeRetentionJob(
  db: TenantDb,
  retentionJobId: string,
  counts: PurgeCounts,
  errorMessage: string | null,
): Promise<void> {
  await db.update(retentionJobs, retentionJobId, {
    status: errorMessage ? 'failed' : 'succeeded',
    processedCount: counts.processed,
    skippedLegalHoldCount: counts.skippedLegalHold,
    errorMessage,
    completedAt: new Date(),
  })
}

async function auditPurge(tenantId: string, entityType: string, counts: PurgeCounts, retentionJobId: string): Promise<void> {
  // No dedicated `retention.anonymized` audit action exists in the closed
  // `audit_action` enum (`db/schema/_shared.ts`) — `'retention.purged'` is
  // reused for the `loads` anonymize path too, with the reason text and the
  // `retention_jobs.action` column (`'anonymize'`, not `'purge'`) making the
  // distinction visible to anyone reading the audit trail.
  const verb = entityType === 'loads' ? 'anonymized' : 'purged'
  await recordAudit(
    null,
    { ipAddress: null, userAgent: null, requestId: newId() },
    {
      tenantId,
      action: 'retention.purged',
      entityType,
      reason: `Statutory retention window elapsed (${counts.processed} ${verb}, ${counts.skippedLegalHold} skipped under legal hold)`,
      metadata: { retentionJobId, ...counts },
    },
  )
}

async function purgeArchivedDocuments(db: TenantDb, now: Date): Promise<{ counts: PurgeCounts; retentionJobId: string }> {
  const eligible = lte(documents.purgeEligibleAt, now)
  const candidateCount = await db.count(documents, eligible)
  const retentionJobId = await openRetentionJob(db, 'documents', now, candidateCount)
  if (candidateCount === 0) return { counts: { candidate: 0, processed: 0, skippedLegalHold: 0 }, retentionJobId }

  const skippedLegalHold = await db.count(documents, and(eligible, eq(documents.legalHold, true))!)
  const processed = await db.purge(documents, and(eligible, eq(documents.legalHold, false))!, {
    retentionJobId,
    legalHoldChecked: true,
  })

  return { counts: { candidate: candidateCount, processed, skippedLegalHold }, retentionJobId }
}

const RETENTION_REDACTED = '[redacted — retention purge]'

/**
 * `loads`' purge strategy: soft-delete (drops it out of every ordinary
 * tenant-scoped view, exactly like a user-initiated delete would) plus
 * redaction of its own free-text, potentially-identifying columns. Naturally
 * idempotent — the candidate query's `isNull(loads.deletedAt)` means an
 * already-anonymized load is never selected again, so re-running this
 * produces the same result set with zero rows touched, not a repeated
 * redaction. Everything structural or financial (ids, dates, amounts, the
 * FK to `customers`) is left alone: `financial_snapshots` — the actual
 * source of truth for a load's money — is unaffected either way, since it
 * is immutable and independently retained under the financial 7-year rule.
 */
async function anonymizeArchivedLoads(db: TenantDb, now: Date): Promise<{ counts: PurgeCounts; retentionJobId: string }> {
  const eligible = and(lte(loads.purgeEligibleAt, now), isNull(loads.deletedAt))!
  const candidateCount = await db.count(loads, eligible)
  const retentionJobId = await openRetentionJob(db, 'loads', now, candidateCount, 'anonymize')
  if (candidateCount === 0) return { counts: { candidate: 0, processed: 0, skippedLegalHold: 0 }, retentionJobId }

  const skippedLegalHold = await db.count(loads, and(eligible, eq(loads.legalHold, true))!)
  const updated = await db.updateWhere(loads, and(eligible, eq(loads.legalHold, false))!, {
    deletedAt: now,
    deletionReason: 'Statutory retention window elapsed — anonymized rather than deleted (see docs/architecture.md §9)',
    customerReference: null,
    poNumber: null,
    specialInstructions: null,
    internalNotes: RETENTION_REDACTED,
    cancellationReason: null,
  })

  return { counts: { candidate: candidateCount, processed: updated.length, skippedLegalHold }, retentionJobId }
}

/** Financial class: no archive step, eligible only once terminal AND past the 7-year (default) cutoff. */
async function purgeInvoices(db: TenantDb, cutoff: Date): Promise<{ counts: PurgeCounts; retentionJobId: string }> {
  const terminalStatuses = ['paid', 'voided', 'uncollectable'] as const
  const eligible = and(
    inArray(invoices.status, terminalStatuses),
    or(lte(invoices.paidAt, cutoff), lte(invoices.voidedAt, cutoff), lte(invoices.createdAt, cutoff))!,
  )!
  const candidateCount = await db.count(invoices, eligible)
  const retentionJobId = await openRetentionJob(db, 'invoices', cutoff, candidateCount)
  if (candidateCount === 0) return { counts: { candidate: 0, processed: 0, skippedLegalHold: 0 }, retentionJobId }

  const skippedLegalHold = await db.count(invoices, and(eligible, eq(invoices.legalHold, true))!)
  const processed = await db.purge(invoices, and(eligible, eq(invoices.legalHold, false))!, {
    retentionJobId,
    legalHoldChecked: true,
  })

  return { counts: { candidate: candidateCount, processed, skippedLegalHold }, retentionJobId }
}

export async function runRetentionPurgeSweep(payload: z.infer<typeof sweepSchema>, ctx: JobContext): Promise<void> {
  if (isProduction() && !payload.confirm) {
    logger.error(
      'retention-purge: refused in production without an explicit confirmation flag on the job payload — a purge is irreversible. Re-enqueue with { confirm: true } once ready.',
      { tenantId: ctx.tenantId ?? undefined },
    )
    return
  }

  const now = new Date()
  const tenantIds = await listAllTenantIds()

  for (const tenantId of tenantIds) {
    const db = tenantDb(tenantId)
    const financialYears = await financialRetentionYearsFor(db)
    const financialCutoff = yearsAgo(now, financialYears)

    const runs: Array<[string, () => Promise<{ counts: PurgeCounts; retentionJobId: string }>]> = [
      ['documents', () => purgeArchivedDocuments(db, now)],
      ['invoices', () => purgeInvoices(db, financialCutoff)],
    ]

    // `classifyEntity('loads').purgeStrategy` is the single source of truth
    // for this decision (`@/server/retention/policy.ts`) — read it rather
    // than re-deciding locally, so this handler and that module cannot
    // drift apart on whether a load is deleted or anonymized.
    if (classifyEntity('loads')?.purgeStrategy === 'anonymize') {
      runs.push(['loads', () => anonymizeArchivedLoads(db, now)])
    } else {
      logger.error('retention-purge: loads purgeStrategy is not "anonymize" — skipping, since hard-deleting a load whose status history exists is structurally impossible (see drizzle/custom/0001_audit_immutability.sql).')
    }

    for (const [entityType, run] of runs) {
      try {
        const { counts, retentionJobId } = await run()
        await closeRetentionJob(db, retentionJobId, counts, null)
        if (counts.processed > 0 || counts.skippedLegalHold > 0) {
          await auditPurge(tenantId, entityType, counts, retentionJobId)
        }
      } catch (error) {
        logger.error('retention-purge: sweep failed', { tenantId, entityType, error })
      }
    }
  }
}

defineJob('retention.purge_sweep', {
  schema: sweepSchema,
  handler: runRetentionPurgeSweep,
  defaultMaxAttempts: 1,
  description: 'Weekly permanent deletion of records past their purge-eligible date, refusing without legal-hold proof.',
})
