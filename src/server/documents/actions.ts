'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { getTenant } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { tenantBranding, documents } from '@/db/schema'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { getStorage } from '@/lib/storage'
import type { ResourceContext, Actor } from '@/lib/permissions'
import {
  addVersion as addVersionService,
  getDownloadUrl as getDownloadUrlService,
  restoreDocument as restoreDocumentService,
  reviewDocument as reviewDocumentService,
  softDeleteDocument as softDeleteDocumentService,
  uploadDocument as uploadDocumentService,
} from './service'
import { ownerResourceFacts, resolveDocumentResourceContext } from './queries'

/**
 * Server actions for the document domain.
 *
 * Every action here is a thin `defineAction` wrapper: input validation, a
 * `resource()` resolver that pins the permission check to the document's real
 * owner (never the client's claim about it), a call into `service.ts`, and an
 * audit event. No business rule lives in this file.
 */

const ownerTypeSchema = z.enum(['carrier', 'truck', 'trailer', 'driver', 'load', 'tenant', 'invoice'])
const documentTypeSchema = z.enum(documents.documentType.enumValues)

async function resourceForNewDocument(
  input: { ownerType: z.infer<typeof ownerTypeSchema>; ownerId: string },
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  return { tenantId: ctx.actor.tenantId, ...ownerResourceFacts(input.ownerType, input.ownerId) }
}

/* ── Upload ──────────────────────────────────────────────────────────────── */

const uploadDocumentInput = z.object({
  ownerType: ownerTypeSchema,
  ownerId: z.string().uuid(),
  documentType: documentTypeSchema,
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  issueDate: z.coerce.date().optional(),
  expirationDate: z.coerce.date().optional(),
  isRequired: z.boolean().optional(),
  originalFilename: z.string().min(1).max(255),
  /** Base64-encoded bytes. The 15 MB cap keeps the encoded payload comfortably under typical body-size limits. */
  fileBase64: z.string().min(1),
})

export const uploadDocument = defineAction({
  name: 'document.upload',
  permission: 'document:upload',
  input: uploadDocumentInput,
  resource: (input, ctx) => resourceForNewDocument(input, ctx),
  handler: async (input, ctx) => {
    const bytes = Buffer.from(input.fileBase64, 'base64')
    return uploadDocumentService(ctx.db, ctx.actor, { ...input, bytes })
  },
  audit: (input, output) => ({
    action: 'document.uploaded',
    entityType: 'document',
    entityId: output.document.id,
    entityLabel: output.document.title ?? input.documentType,
    metadata: {
      documentType: input.documentType,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      versionNumber: output.version.versionNumber,
    },
  }),
})

/* ── New version ─────────────────────────────────────────────────────────── */

const addVersionInput = z.object({
  documentId: z.string().uuid(),
  originalFilename: z.string().min(1).max(255),
  fileBase64: z.string().min(1),
})

export const addDocumentVersion = defineAction({
  name: 'document.addVersion',
  permission: 'document:upload',
  input: addVersionInput,
  resource: (input, ctx) => resolveDocumentResourceContext(tenantDbFor(ctx.actor), input.documentId),
  handler: async (input, ctx) => {
    const bytes = Buffer.from(input.fileBase64, 'base64')
    return addVersionService(ctx.db, ctx.actor, { ...input, bytes })
  },
  audit: (_input, output) => ({
    action: 'document.uploaded',
    entityType: 'document',
    entityId: output.document.id,
    metadata: { versionNumber: output.version.versionNumber, newVersion: true },
  }),
})

/* ── Review ──────────────────────────────────────────────────────────────── */

const reviewDocumentInput = z.object({
  documentId: z.string().uuid(),
  status: z.enum(['approved', 'rejected']),
  notes: z.string().max(2000).optional(),
  rejectionReason: z.string().max(2000).optional(),
})

export const reviewDocument = defineAction({
  name: 'document.review',
  permission: 'document:review',
  input: reviewDocumentInput,
  resource: (input, ctx) => resolveDocumentResourceContext(tenantDbFor(ctx.actor), input.documentId),
  handler: (input, ctx) => reviewDocumentService(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: output.document.reviewStatus === 'approved' ? 'document.approved' : 'document.rejected',
    entityType: 'document',
    entityId: output.document.id,
    reason: input.status === 'rejected' ? input.rejectionReason : undefined,
    metadata: { notes: input.notes },
  }),
})

/* ── Download ────────────────────────────────────────────────────────────── */

const getDocumentDownloadUrlInput = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid().optional(),
  watermark: z.boolean().optional(),
})

export const getDocumentDownloadUrl = defineAction({
  name: 'document.download',
  permission: 'document:download',
  input: getDocumentDownloadUrlInput,
  resource: (input, ctx) => resolveDocumentResourceContext(tenantDbFor(ctx.actor), input.documentId),
  handler: async (input, ctx) => {
    const tenant = await getTenant(ctx.actor.tenantId)
    const branding = await ctx.db.findFirst(tenantBranding)

    let logoPngBytes: Uint8Array | undefined
    if (branding?.logoStorageKey) {
      try {
        const stored = await getStorage().get(branding.logoStorageKey)
        if (stored.contentType === 'image/png') logoPngBytes = stored.body
      } catch {
        // Branding is decorative; a missing/unreadable logo must never block a download.
      }
    }

    const dictionary = await getDictionary(ctx.actor.locale)
    const t = createTranslator(dictionary, ctx.actor.locale)

    return getDownloadUrlService(
      ctx.db,
      ctx.actor,
      ctx.request,
      input,
      {
        tenantName: tenant?.displayName ?? 'Goliath Dispatch',
        timezone: tenant?.defaultTimezone ?? 'America/New_York',
        logoPngBytes,
      },
      t,
      ctx.actor.locale,
    )
  },
  audit: (input, output) => ({
    action: 'document.downloaded',
    entityType: 'document',
    entityId: output.document.id,
    metadata: { watermarked: output.watermarked, versionNumber: output.version.versionNumber },
  }),
})

/* ── Delete / restore ────────────────────────────────────────────────────── */

const documentIdInput = z.object({
  documentId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})

export const deleteDocument = defineAction({
  name: 'document.delete',
  permission: 'document:delete',
  input: documentIdInput,
  resource: (input, ctx) => resolveDocumentResourceContext(tenantDbFor(ctx.actor), input.documentId),
  handler: (input, ctx) => softDeleteDocumentService(ctx.db, ctx.actor, input.documentId, input.reason),
  audit: (input, output) => ({
    action: 'document.deleted',
    entityType: 'document',
    entityId: output.id,
    reason: input.reason ?? 'not provided',
  }),
})

export const restoreDocument = defineAction({
  name: 'document.restore',
  permission: 'document:delete',
  input: z.object({ documentId: z.string().uuid() }),
  resource: (input, ctx) => resolveDocumentResourceContext(tenantDbFor(ctx.actor), input.documentId),
  handler: (input, ctx) => restoreDocumentService(ctx.db, input.documentId),
  // No `document.restored` audit action exists in the catalog (only the five
  // actions named in the architecture doc do); restoring is rare enough, and
  // significant enough, that it should get its own action rather than
  // borrowing a misleading one — left for whoever extends `auditActionEnum`.
})

/**
 * `resource()` runs before `ctx.db` exists (the tenant-bound handle is built
 * only once the permission check has passed), so resolving a document's
 * owner for the scope check needs its own short-lived handle. `tenantDb()` is
 * cheap — it wraps the existing pooled connection, not a new one.
 */
function tenantDbFor(actor: Actor) {
  if (!actor.tenantId) throw new Error('resource resolver requires a tenant-scoped actor')
  return tenantDb(actor.tenantId)
}
