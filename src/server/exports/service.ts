import 'server-only'
import { z } from 'zod'
import { exportJobs, jobQueue, type ExportJob } from '@/db/schema'
import type { TenantDb } from '@/db/tenant-db'
import type { Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { authorize, scopeFilter, type Actor, type ScopeFilter, type TenantPolicy } from '@/lib/permissions'
import { AppError, conflict, forbidden, notFound, validationFailed } from '@/lib/errors'
import { recordAudit, type AuditRequestContext } from '@/lib/audit'
import { enforceRateLimit, rateLimitPolicies } from '@/lib/rate-limit'
import { getStorage, assertKeyBelongsToTenant } from '@/lib/storage'
import { newId } from '@/lib/crypto'
import { getTenant } from '@/server/context'
import { getReport } from '@/server/reports/registry'
import { runReportWithScope } from '@/server/reports/runner'
import { buildCsv } from './csv'
import { buildXlsx } from './xlsx'
import { buildPdf } from './pdf'

/**
 * The export contract.
 *
 * `requestExport` is the only way an `export_jobs` row is created: it
 * validates the report's own filter schema, checks the report's
 * `requiredPermission`, and freezes the actor's *resolved scope* into
 * `scopeSnapshot` — not the actor's role, not their id, the already-evaluated
 * `ScopeFilter`. `generateExport` is the pure function a background handler
 * (owned by the jobs agent, under `src/jobs/**`) calls once it has dequeued
 * the `report-export` job: it re-reads that snapshot and runs the report
 * through it, so the artifact reflects exactly what the requester could see
 * at request time, regardless of who or what the worker is running as.
 */

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** How long a completed export artifact remains downloadable. */
export const EXPORT_ARTIFACT_TTL_DAYS = 7

const requestExportSchema = z.object({
  reportKey: z.string().min(1),
  format: z.enum(EXPORT_FORMATS),
  filters: z.record(z.string(), z.unknown()).default({}),
})

export type RequestExportInput = z.infer<typeof requestExportSchema>

interface ScopeSnapshotPayload {
  scope: ScopeFilter
  locale: Locale
  timezone: string
  requestedByEmail: string
  requestedByName: string
  reportTitle: string
  tenantName: string
}

export async function requestExport(
  db: TenantDb,
  actor: Actor & { tenantId: string },
  policy: TenantPolicy | null,
  request: AuditRequestContext,
  rawInput: unknown,
): Promise<ExportJob> {
  const input = requestExportSchema.parse(rawInput)

  const definition = getReport(input.reportKey)
  if (!definition) throw notFound('report.errors.unknownReport', { reportKey: input.reportKey })

  const parsedFilters = definition.filterSchema.safeParse(input.filters)
  if (!parsedFilters.success) {
    throw validationFailed('errors.validationFailed', parsedFilters.error.flatten())
  }

  const grantedScope = authorize(actor, definition.requiredPermission, undefined, policy)
  const scope = scopeFilter(actor, grantedScope)

  const rateLimit = await enforceRateLimit(rateLimitPolicies.exportGeneration(actor.userId), request, actor.tenantId)
  if (!rateLimit.allowed) {
    throw new AppError('rate_limited', 'errors.rateLimited', {
      params: { retryAfterSeconds: rateLimit.retryAfterSeconds },
    })
  }

  const tenant = await getTenant(actor.tenantId)

  const snapshot: ScopeSnapshotPayload = {
    scope,
    locale: actor.locale,
    timezone: tenant?.defaultTimezone ?? 'America/New_York',
    requestedByEmail: actor.email,
    requestedByName: `${actor.firstName} ${actor.lastName}`,
    reportTitle: definition.titleKey,
    tenantName: tenant?.displayName ?? 'Goliath Dispatch',
  }

  const job = await db.transaction(async (tx) => {
    const row = await tx.insert(exportJobs, {
      requestedByUserId: actor.userId,
      reportKey: input.reportKey,
      format: input.format,
      filters: parsedFilters.data as Record<string, unknown>,
      scopeSnapshot: snapshot as unknown as Record<string, unknown>,
      status: 'queued',
    })

    await tx.insert(jobQueue, {
      jobType: 'report-export',
      payload: { exportJobId: row.id },
      dedupeKey: `report-export:${row.id}`,
      maxAttempts: 3,
    })

    return row
  })

  await recordAudit(actor, request, {
    action: 'export.created',
    entityType: 'export_job',
    entityId: job.id,
    entityLabel: input.reportKey,
    tenantId: actor.tenantId,
    metadata: { format: input.format, filters: parsedFilters.data },
  })

  return job
}

export interface DownloadExportResult {
  url: string
  filename: string
}

export async function downloadExport(
  db: TenantDb,
  actor: Actor & { tenantId: string },
  request: AuditRequestContext,
  exportJobId: string,
): Promise<DownloadExportResult> {
  const job = await db.findById(exportJobs, exportJobId)
  if (!job) throw notFound('report.errors.exportNotFound')

  // Only the requester or someone holding tenant-wide report access may
  // download; scope is otherwise irrelevant here because the artifact was
  // already generated under the requester's own snapshot.
  const isOwner = job.requestedByUserId === actor.userId
  if (!isOwner && actor.role !== 'admin' && !actor.isPlatformSuperAdmin) {
    throw forbidden('errors.forbidden')
  }

  if (job.status !== 'succeeded' || !job.storageKey) {
    throw conflict('report.errors.exportNotReady')
  }
  if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
    throw conflict('report.errors.exportExpired')
  }

  assertKeyBelongsToTenant(job.storageKey, actor.tenantId)
  const url = await getStorage().signedDownloadUrl(job.storageKey, {
    responseContentDisposition: `attachment; filename="${job.reportKey}.${job.format}"`,
  })

  await db.update(exportJobs, job.id, { downloadedAt: new Date() })

  await recordAudit(actor, request, {
    action: 'export.downloaded',
    entityType: 'export_job',
    entityId: job.id,
    entityLabel: job.reportKey,
    tenantId: actor.tenantId,
  })

  return { url, filename: `${job.reportKey}.${job.format}` }
}

/**
 * Pure generation. Called by the background handler once it has resolved a
 * `TenantDb` bound to the job's own `tenantId` (never the worker's ambient
 * context, which has none). Re-derives everything needed to render the
 * artifact from the stored row — never from a live actor.
 */
export async function generateExport(db: TenantDb, exportJobId: string): Promise<ExportJob> {
  const job = await db.requireById(exportJobs, exportJobId, 'export_job')
  const snapshot = job.scopeSnapshot as unknown as ScopeSnapshotPayload | null
  if (!snapshot?.scope) {
    return failJob(db, job.id, 'report.errors.missingScopeSnapshot')
  }

  const definition = getReport(job.reportKey)
  if (!definition) {
    return failJob(db, job.id, 'report.errors.unknownReport')
  }

  await db.update(exportJobs, job.id, { status: 'running', startedAt: new Date() })

  try {
    const result = await runReportWithScope({
      reportKey: job.reportKey,
      db,
      tenantId: db.tenantId,
      scope: snapshot.scope,
      rawFilters: job.filters,
      locale: snapshot.locale,
    })

    const dictionary = await getDictionary(snapshot.locale, ['report', 'common'])
    const t = createTranslator(dictionary, snapshot.locale)
    const reportTitle = t(definition.titleKey)

    // Older queued jobs may have a scope snapshot recorded before `timezone`
    // was added to the payload — fall back the same way every other
    // tenant-timezone read site in this codebase does.
    const timeZone = snapshot.timezone ?? 'America/New_York'

    let body: Buffer
    let contentType: string
    if (job.format === 'csv') {
      body = Buffer.from(buildCsv(result.columns, result.rows, snapshot.locale, t, timeZone), 'utf8')
      contentType = 'text/csv; charset=utf-8'
    } else if (job.format === 'xlsx') {
      body = await buildXlsx(result.columns, result.rows, snapshot.locale, t, timeZone, {
        generatedByEmail: snapshot.requestedByEmail,
        generatedAt: new Date(),
        reportTitle,
        filters: job.filters,
      })
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    } else {
      body = await buildPdf(result.columns, result.rows, snapshot.locale, t, timeZone, {
        reportTitle,
        tenantName: snapshot.tenantName,
        generatedByEmail: snapshot.requestedByEmail,
        generatedAt: new Date(),
        locale: snapshot.locale,
      })
      contentType = 'application/pdf'
    }

    const storageKey = `tenants/${db.tenantId}/exports/${job.id}/${job.reportKey}-${newId()}.${job.format}`
    assertKeyBelongsToTenant(storageKey, db.tenantId)
    await getStorage().put({ key: storageKey, body, contentType })

    const expiresAt = new Date(Date.now() + EXPORT_ARTIFACT_TTL_DAYS * 24 * 60 * 60 * 1000)
    const updated = await db.update(exportJobs, job.id, {
      status: 'succeeded',
      rowCount: result.rows.length,
      storageKey,
      completedAt: new Date(),
      expiresAt,
    })
    return updated ?? job
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return failJob(db, job.id, message)
  }
}

async function failJob(db: TenantDb, jobId: string, message: string): Promise<ExportJob> {
  const updated = await db.update(exportJobs, jobId, {
    status: 'failed',
    errorMessage: message,
    completedAt: new Date(),
  })
  if (!updated) throw notFound('report.errors.exportNotFound')
  return updated
}
