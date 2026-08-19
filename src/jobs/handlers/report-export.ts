import 'server-only'
import { z } from 'zod'
import { tenantDb } from '@/db/tenant-db'
import { generateExport } from '@/server/exports/service'
import { getReport } from '@/server/reports/registry'
import { emitNotification, loadRecipientProfile } from '@/server/notifications/dispatch'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { logger } from '@/lib/logger'
import { defineJob, type JobContext } from '../registry'

/**
 * Generates the artifact for one queued `export_jobs` row.
 *
 * All of the actual work — re-applying the requester's frozen
 * `scopeSnapshot` (never a live, possibly-widened, permission check),
 * running the report, and rendering CSV/XLSX/PDF — lives in
 * `src/server/exports/service.ts::generateExport()`, which that module's
 * own header comment already documents as "called by the background
 * handler (owned by the jobs agent, under `src/jobs/**`)". This handler is
 * the thin queue-side wrapper the exports module asked for: resolve the
 * job's own tenant, call it, and translate a `failed` result into a thrown
 * error so the queue's normal retry/dead-letter policy applies — otherwise
 * a transient storage or rendering failure would silently never retry.
 *
 * Idempotent: `generateExport()` re-reads `job.filters`/`job.scopeSnapshot`
 * from the row itself every time, so a retried attempt regenerates the same
 * artifact from the same inputs; only the storage key (which embeds a fresh
 * id) differs between attempts, and the row's own `storageKey` is
 * overwritten with whichever attempt last succeeded. `emitNotification`'s
 * own dedupe (`notifications_dedupe_uq`, keyed off the export job's id) makes
 * a retried final attempt harmless too — it never double-notifies.
 *
 * On success, the requester is told their download is ready via the
 * `export.ready` catalog entry (`src/server/notifications/catalog.ts`),
 * addressed directly to `requestedByUserId` — the frozen scope snapshot this
 * job already trusts, not a live audience resolution.
 */

const payloadSchema = z.object({ exportJobId: z.string().uuid() })

export async function generateQueuedExport(payload: z.infer<typeof payloadSchema>, ctx: JobContext): Promise<void> {
  if (!ctx.tenantId) throw new Error('report-export requires a tenantId')
  const db = tenantDb(ctx.tenantId)

  const result = await generateExport(db, payload.exportJobId)

  if (result.status === 'failed') {
    throw new Error(`export job ${result.id} failed: ${result.errorMessage ?? 'unknown error'}`)
  }

  logger.info('jobs: export generated', {
    tenantId: ctx.tenantId,
    exportJobId: result.id,
    reportKey: result.reportKey,
    format: result.format,
    rowCount: result.rowCount ?? undefined,
  })

  const profile = await loadRecipientProfile(db, result.requestedByUserId)
  const locale = profile?.locale ?? 'en'
  const definition = getReport(result.reportKey)
  const dictionary = await getDictionary(locale, ['report'])
  const t = createTranslator(dictionary, locale)
  const reportName = definition ? t(definition.titleKey) : result.reportKey

  await emitNotification({
    tenantId: ctx.tenantId,
    eventKey: 'export.ready',
    subject: { type: 'export_job', id: result.id },
    tokens: { reportName, format: result.format.toUpperCase(), rowCount: result.rowCount ?? 0 },
    recipientUserIds: [result.requestedByUserId],
    actionUrl: `/app/reports/${result.reportKey}?exportJobId=${result.id}`,
  })
}

defineJob('report-export', {
  schema: payloadSchema,
  handler: generateQueuedExport,
  defaultMaxAttempts: 3,
  description: 'Generates the CSV/XLSX/PDF artifact for one queued export_jobs row under its frozen permission scope.',
})
