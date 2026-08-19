'use server'

import { z } from 'zod'
import { defineAction, actionFailure, type ActionResult } from '@/server/action'
import { getRequestMeta } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import type { Actor, ResourceContext } from '@/lib/permissions'
import { emailSchema, localeSchema, reasonSchema, uuidSchema } from '@/lib/validation'
import {
  createNewTemplateVersion,
  createTemplate,
  listActiveTemplates,
  renderTemplate,
  retireTemplate,
} from './templates'
import {
  createSignatureRequest,
  declineSignature,
  documentActorFor,
  recordCeremonyEvent,
  recordView,
  resolveSignatureRequestByToken,
  resolveSignedRequestForDownload,
  signDocument,
  voidSignatureRequest,
} from './service'
import { getSignatureRecordByRequestId, resolveSignatureRequestResourceContext } from './queries'
import { getDownloadUrl as getDocumentDownloadUrl } from '@/server/documents/service'
import { getTenant } from '@/server/context'
import { tenantBranding } from '@/db/schema'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { getStorage } from '@/lib/storage'
import { notFound } from '@/lib/errors'

/**
 * Server actions for the signatures domain.
 *
 * Template management, request creation, voiding and certificate download are
 * staff actions and go through `defineAction` like everything else in the
 * app. The signing ceremony itself (`resolveSign*`, `submitSignature*`,
 * `declineSignature*`) is reached by whoever holds the token in the email —
 * possibly nobody with an account at all — so those functions are plain
 * `'use server'` exports that build the same `ActionResult` shape by hand:
 * they authenticate the *token*, not a session, rate-limit inside
 * `resolveSignatureRequestByToken`, and audit inside `service.ts`.
 */

function tenantContext(ctx: { actor: Actor }): { tenantId: string | null } {
  return { tenantId: ctx.actor.tenantId }
}

/* ── Templates ───────────────────────────────────────────────────────────── */

const templateFieldsInput = z.object({
  titleEn: z.string().trim().min(1).max(200),
  titleEs: z.string().trim().min(1).max(200),
  bodyEn: z.string().trim().min(1),
  bodyEs: z.string().trim().min(1),
  consentCopyEn: z.string().trim().min(1),
  consentCopyEs: z.string().trim().min(1),
  requiredTokens: z.array(z.string().trim().min(1)),
})

const createTemplateInput = templateFieldsInput.extend({
  templateKey: z.string().trim().min(1).max(60),
})

export const createSignatureTemplateAction = defineAction({
  name: 'signature.template.create',
  permission: 'signature:template:manage',
  input: createTemplateInput,
  resource: (_input, ctx) => tenantContext(ctx),
  handler: (input, ctx) => createTemplate(ctx.db, input),
  audit: (input, output) => ({
    action: 'settings.updated',
    entityType: 'signatureTemplate',
    entityId: output.id,
    entityLabel: input.templateKey,
    metadata: { version: output.version, action: 'created' },
  }),
})

const createTemplateVersionInput = templateFieldsInput.extend({
  templateKey: z.string().trim().min(1).max(60),
})

export const createSignatureTemplateVersionAction = defineAction({
  name: 'signature.template.createVersion',
  permission: 'signature:template:manage',
  input: createTemplateVersionInput,
  resource: (_input, ctx) => tenantContext(ctx),
  handler: (input, ctx) => createNewTemplateVersion(ctx.db, input.templateKey, input),
  audit: (input, output) => ({
    action: 'settings.updated',
    entityType: 'signatureTemplate',
    entityId: output.id,
    entityLabel: input.templateKey,
    metadata: { version: output.version, action: 'new_version' },
  }),
})

const retireTemplateInput = z.object({ templateKey: z.string().trim().min(1).max(60) })

export const retireSignatureTemplateAction = defineAction({
  name: 'signature.template.retire',
  permission: 'signature:template:manage',
  input: retireTemplateInput,
  resource: (_input, ctx) => tenantContext(ctx),
  handler: (input, ctx) => retireTemplate(ctx.db, input.templateKey),
  audit: (input, output) => ({
    action: 'settings.updated',
    entityType: 'signatureTemplate',
    entityId: output.id,
    entityLabel: input.templateKey,
    metadata: { version: output.version, action: 'retired' },
  }),
})

/* ── Request creation ────────────────────────────────────────────────────── */

const createRequestInput = z.object({
  templateKey: z.string().trim().min(1).max(60),
  subjectType: z.enum(['carrier', 'load', 'tenant']),
  subjectId: uuidSchema,
  carrierId: uuidSchema.optional().nullable(),
  signerUserId: uuidSchema.optional().nullable(),
  signerEmail: emailSchema,
  locale: localeSchema,
  tokenValues: z.record(z.string(), z.string()),
  expiresInDays: z.number().int().min(1).max(365).optional(),
})

async function createRequestResource(
  input: z.infer<typeof createRequestInput>,
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  const carrierId = input.carrierId ?? (input.subjectType === 'carrier' ? input.subjectId : null)
  return { ...tenantContext(ctx), carrierId: carrierId ?? undefined }
}

export const createSignatureRequestAction = defineAction({
  name: 'signature.request.create',
  permission: 'signature:request:create',
  input: createRequestInput,
  resource: (input, ctx) => createRequestResource(input, ctx),
  handler: (input, ctx) =>
    createSignatureRequest(ctx.db, { ...input, requestedByUserId: ctx.actor.userId }),
  audit: (input, output) => ({
    action: 'signature.requested',
    entityType: 'signatureRequest',
    entityId: output.request.id,
    metadata: { templateKey: input.templateKey, subjectType: input.subjectType, subjectId: input.subjectId },
  }),
})

/**
 * Minimal template listing for the "send for signature" picker. Deliberately
 * gated on `signature:request:create` (not `signature:template:read`) so a
 * dispatcher — who can send requests but has no template-management access —
 * can still pick a template to send.
 */
export interface SignatureTemplateOption {
  templateKey: string
  titleEn: string
  titleEs: string
  version: number
  requiredTokens: string[]
}

const listTemplatesForRequestInput = z.object({ carrierId: uuidSchema.optional().nullable() })

export const listSignatureTemplatesForRequestAction = defineAction({
  name: 'signature.template.listForRequest',
  permission: 'signature:request:create',
  input: listTemplatesForRequestInput,
  resource: (input, ctx) => ({ ...tenantContext(ctx), carrierId: input.carrierId ?? undefined }),
  handler: async (_input, ctx): Promise<SignatureTemplateOption[]> => {
    const templates = await listActiveTemplates(ctx.db)
    return templates.map((template) => ({
      templateKey: template.templateKey,
      titleEn: template.titleEn,
      titleEs: template.titleEs,
      version: template.version,
      requiredTokens: template.requiredTokens,
    }))
  },
})

/* ── Void ────────────────────────────────────────────────────────────────── */

const voidRequestInput = z.object({ requestId: uuidSchema, reason: reasonSchema })

export const voidSignatureRequestAction = defineAction({
  name: 'signature.void',
  permission: 'signature:void',
  input: voidRequestInput,
  resource: (input, ctx) => resolveSignatureRequestResourceContext(tenantDb(ctx.actor.tenantId!), input.requestId),
  handler: (input, ctx) => voidSignatureRequest(ctx.db, { ...input, actorUserId: ctx.actor.userId }),
  audit: (input, output) => ({
    action: 'signature.voided',
    entityType: 'signatureRequest',
    entityId: output.id,
    reason: input.reason,
  }),
})

/* ── Certificate download ────────────────────────────────────────────────── */

const downloadCertificateInput = z.object({ requestId: uuidSchema })

export const downloadSignatureCertificateAction = defineAction({
  name: 'signature.certificate.download',
  permission: 'signature:certificate:download',
  input: downloadCertificateInput,
  resource: (input, ctx) => resolveSignatureRequestResourceContext(tenantDb(ctx.actor.tenantId!), input.requestId),
  handler: async (input, ctx) => {
    const record = await getSignatureRecordByRequestId(ctx.db, input.requestId)
    if (!record?.auditCertificateDocumentId) {
      throw notFound('signature.errors.certificateNotReady')
    }
    const tenant = await getTenant(ctx.actor.tenantId)
    const branding = await ctx.db.findFirst(tenantBranding)
    let logoPngBytes: Uint8Array | undefined
    if (branding?.logoStorageKey) {
      try {
        const stored = await getStorage().get(branding.logoStorageKey)
        if (stored.contentType === 'image/png') logoPngBytes = stored.body
      } catch {
        // Branding is decorative; never block a certificate download over a missing logo.
      }
    }
    const dictionary = await getDictionary(ctx.actor.locale)
    const t = createTranslator(dictionary, ctx.actor.locale)
    const result = await getDocumentDownloadUrl(
      ctx.db,
      ctx.actor,
      ctx.request,
      { documentId: record.auditCertificateDocumentId },
      {
        tenantName: tenant?.displayName ?? 'Goliath Dispatch',
        timezone: tenant?.defaultTimezone ?? 'America/New_York',
        logoPngBytes,
      },
      t,
      ctx.actor.locale,
    )
    await recordCeremonyEvent(ctx.db, {
      requestId: input.requestId,
      recordId: record.id,
      eventType: 'certificate_downloaded',
      actorUserId: ctx.actor.userId,
      actorEmail: ctx.actor.email,
    })
    return result
  },
})

/* ── Public signing ceremony (token-authenticated, no session) ───────────── */

const tokenInput = z.object({ token: z.string().trim().min(10) })

export interface ResolveSignInfo {
  requestId: string
  status: string
  locale: 'en' | 'es'
  signerEmail: string
  templateKey: string
  templateVersion: number
  title: string
  body: string
  consentCopy: string
  requiredTokens: string[]
  tokenValues: Record<string, string>
  tenantName: string
}

/** Resolves a raw signer token into everything the ceremony page needs to render — never the raw token or its hash. */
export async function resolveSignInfoAction(rawInput: unknown): Promise<ActionResult<ResolveSignInfo>> {
  try {
    const { token } = tokenInput.parse(rawInput)
    const { request, template } = await resolveSignatureRequestByToken(token)
    const tenant = await getTenant(request.tenantId)
    const rendered = renderTemplate(template, request.tokenValues, request.locale)
    return {
      ok: true,
      data: {
        requestId: request.id,
        status: request.status,
        locale: request.locale,
        signerEmail: request.signerEmail,
        templateKey: template.templateKey,
        templateVersion: template.version,
        title: rendered.title,
        body: rendered.body,
        consentCopy: rendered.consentCopy,
        requiredTokens: template.requiredTokens,
        tokenValues: request.tokenValues,
        tenantName: tenant?.displayName ?? 'Goliath Dispatch',
      },
    }
  } catch (error) {
    return actionFailure(error)
  }
}

const recordViewInput = z.object({ token: z.string().trim().min(10), eventType: z.enum(['opened', 'viewed']) })

export async function recordSignatureViewAction(rawInput: unknown): Promise<ActionResult<{ ok: true }>> {
  try {
    const input = recordViewInput.parse(rawInput)
    const { request } = await resolveSignatureRequestByToken(input.token)
    const requestMeta = await getRequestMeta()
    const db = tenantDb(request.tenantId)
    await recordView(db, {
      requestId: request.id,
      eventType: input.eventType,
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    })
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return actionFailure(error)
  }
}

const submitSignatureInput = z.object({
  token: z.string().trim().min(10),
  signerLegalName: z.string().trim().min(1).max(200),
  signerTitle: z.string().trim().max(120).optional(),
  method: z.enum(['drawn', 'typed']),
  signatureDataUrl: z.string().min(1).nullable(),
  typedName: z.string().max(200).optional().nullable(),
  hasDrawnStrokes: z.boolean(),
  consentAccepted: z.boolean(),
})

export interface SubmitSignatureResult {
  recordId: string
  requestId: string
}

export async function submitSignatureAction(rawInput: unknown): Promise<ActionResult<SubmitSignatureResult>> {
  try {
    const input = submitSignatureInput.parse(rawInput)
    const { request } = await resolveSignatureRequestByToken(input.token)
    const requestMeta = await getRequestMeta()
    const db = tenantDb(request.tenantId)

    const result = await signDocument(db, {
      requestId: request.id,
      signerLegalName: input.signerLegalName,
      signerTitle: input.signerTitle ?? null,
      method: input.method,
      signatureDataUrl: input.signatureDataUrl,
      typedName: input.typedName ?? null,
      hasDrawnStrokes: input.hasDrawnStrokes,
      consentAccepted: input.consentAccepted,
      locale: request.locale,
      ip: requestMeta.ipAddress ?? 'unknown',
      userAgent: requestMeta.userAgent ?? 'unknown',
      actorUserId: request.signerUserId,
    })

    return { ok: true, data: { recordId: result.record.id, requestId: result.request.id } }
  } catch (error) {
    return actionFailure(error)
  }
}

const downloadArtifactInput = z.object({
  token: z.string().trim().min(10),
  artifact: z.enum(['document', 'certificate']),
})

/** Public, post-signature download for the confirmation screen — the signer's own two documents, no account required. */
export async function downloadSignedArtifactAction(rawInput: unknown): Promise<ActionResult<{ url: string }>> {
  try {
    const input = downloadArtifactInput.parse(rawInput)
    const { request, record } = await resolveSignedRequestForDownload(input.token)
    const documentId = input.artifact === 'document' ? record.signedDocumentId : record.auditCertificateDocumentId
    if (!documentId) throw notFound('signature.errors.certificateNotReady')

    const documentUploaderId = request.requestedByUserId ?? record.signerUserId
    if (!documentUploaderId) throw notFound('signature.errors.requestNotFound')

    const db = tenantDb(request.tenantId)
    const requestMeta = await getRequestMeta()
    const actor = documentActorFor(db.tenantId, documentUploaderId, request.locale)
    const tenant = await getTenant(request.tenantId)
    const dictionary = await getDictionary(request.locale)
    const t = createTranslator(dictionary, request.locale)

    const result = await getDocumentDownloadUrl(
      db,
      actor,
      requestMeta,
      { documentId },
      { tenantName: tenant?.displayName ?? 'Goliath Dispatch', timezone: tenant?.defaultTimezone ?? 'America/New_York' },
      t,
      request.locale,
    )
    return { ok: true, data: { url: result.url } }
  } catch (error) {
    return actionFailure(error)
  }
}

const declineInput = z.object({ token: z.string().trim().min(10), reason: reasonSchema })

export async function declineSignatureAction(rawInput: unknown): Promise<ActionResult<{ requestId: string }>> {
  try {
    const input = declineInput.parse(rawInput)
    const { request } = await resolveSignatureRequestByToken(input.token)
    const requestMeta = await getRequestMeta()
    const db = tenantDb(request.tenantId)

    const updated = await declineSignature(db, {
      requestId: request.id,
      reason: input.reason,
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
      actorEmail: request.signerEmail,
    })

    return { ok: true, data: { requestId: updated.id } }
  } catch (error) {
    return actionFailure(error)
  }
}
