'use server'

import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { defineAction } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { requestExport, downloadExport, EXPORT_FORMATS, type DownloadExportResult } from './service'
import { exportJobs, type ExportJob } from '@/db/schema'
import { forbidden } from '@/lib/errors'

/**
 * Server actions for the export lifecycle.
 *
 * Neither action passes a fixed `permission` to `defineAction`: which
 * permission applies depends on *which report* is being exported (most
 * require `report:read`, the audit-activity report requires `audit:read`),
 * so `requestExport()` itself resolves the report definition and calls
 * `authorize()` against its own `requiredPermission` — see
 * `src/server/exports/service.ts`. `downloadExport()` similarly checks
 * ownership/admin access against the specific job row, not a role name.
 */

const requestExportActionInput = z.object({
  reportKey: z.string().min(1),
  format: z.enum(EXPORT_FORMATS),
  filters: z.record(z.string(), z.unknown()).optional(),
})

export const requestExportAction = defineAction<z.infer<typeof requestExportActionInput>, ExportJob>({
  name: 'exports.request',
  permission: null,
  input: requestExportActionInput,
  handler: async (input, ctx) => {
    const policy = await getTenantPolicy(ctx.actor.tenantId)
    return requestExport(ctx.db, ctx.actor, policy, ctx.request, { ...input, filters: input.filters ?? {} })
  },
})

const downloadExportActionInput = z.object({ exportJobId: z.string().uuid() })

export const downloadExportAction = defineAction<z.infer<typeof downloadExportActionInput>, DownloadExportResult>({
  name: 'exports.download',
  permission: null,
  input: downloadExportActionInput,
  handler: async (input, ctx) => downloadExport(ctx.db, ctx.actor, ctx.request, input.exportJobId),
})

/** Polls the status of one export job. Same ownership rule as `downloadExport`. */
const getExportJobActionInput = z.object({ exportJobId: z.string().uuid() })

export const getExportJobAction = defineAction<z.infer<typeof getExportJobActionInput>, ExportJob>({
  name: 'exports.status',
  permission: null,
  input: getExportJobActionInput,
  handler: async (input, ctx) => {
    const job = await ctx.db.requireById(exportJobs, input.exportJobId, 'export_job')
    const isOwner = job.requestedByUserId === ctx.actor.userId
    if (!isOwner && ctx.actor.role !== 'admin' && !ctx.actor.isPlatformSuperAdmin) throw forbidden('errors.forbidden')
    return job
  },
})

/** The most recent export jobs for one report, for the "exports history" panel. */
const listExportJobsActionInput = z.object({ reportKey: z.string().min(1) })

export const listExportJobsAction = defineAction<z.infer<typeof listExportJobsActionInput>, ExportJob[]>({
  name: 'exports.list',
  permission: null,
  input: listExportJobsActionInput,
  handler: async (input, ctx) => {
    const isPrivileged = ctx.actor.role === 'admin' || ctx.actor.isPlatformSuperAdmin
    const where = isPrivileged
      ? eq(exportJobs.reportKey, input.reportKey)
      : and(eq(exportJobs.reportKey, input.reportKey), eq(exportJobs.requestedByUserId, ctx.actor.userId))!
    return ctx.db.findMany(exportJobs, { where, orderBy: desc(exportJobs.createdAt), limit: 10 })
  },
})
