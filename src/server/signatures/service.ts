import 'server-only'
import { eq } from 'drizzle-orm'
import { tenantDb, type TenantDb } from '@/db/tenant-db'
import {
  documentVersions,
  documents,
  signatureRecords,
  signatureRequests,
  signatureTemplates,
  tenantBranding,
  type SignatureAuditEvent,
  type SignatureRecord,
  type SignatureRequest,
  type SignatureTemplate,
} from '@/db/schema'
import { generateToken, hashToken, hmacHex, safeEqual, sha256Hex } from '@/lib/crypto'
import { AppError, conflict, notFound, validationFailed } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { serverEnv, publicEnv } from '@/lib/env'
import { checkRateLimit, rateLimitPolicies } from '@/lib/rate-limit'
import {
  assertKeyBelongsToTenant,
  getStorage,
  sniffMimeType,
  DOCUMENT_UPLOAD_POLICY,
  type DocumentOwnerType,
} from '@/lib/storage'
import { uploadDocument as uploadDocumentService } from '@/server/documents/service'
import { getTenant } from '@/server/context'
import { getEmailProvider, renderEmailShell } from '@/integrations/email'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import type { Locale } from '@/i18n/config'
import type { Actor } from '@/lib/permissions'
import { renderSignedAgreementPdf } from '@/lib/pdf/signed-agreement-pdf'
import { renderAuditCertificatePdf } from '@/lib/pdf/audit-certificate-pdf'
import {
  appendSignatureAuditEvent,
  verifyChain,
  type SignatureEventType,
} from './audit-chain'
import { getActiveTemplate, renderTemplate } from './templates'
import { listAuditEventsForRequest } from './queries'

/**
 * The signing ceremony: create a request, resolve it by token, capture a
 * signature, decline or void, and independently re-verify what was recorded.
 *
 * Everything that touches `signatureRequests`/`signatureRecords` state goes
 * through here — `actions.ts` is a thin, permission-checked front door.
 */

/* ── Access tokens ───────────────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The raw signing link token is `${tenantId}.${randomSecret}`. Embedding the
 * tenant id in the token itself — rather than looking a bare random token up
 * across every tenant — is what lets this module resolve a signer's link
 * without ever needing an unscoped, cross-tenant database handle: the token
 * is parsed to pick a `tenantDb(tenantId)`, and the *entire* raw string
 * (including the tenant id) is then hashed and matched against that one
 * tenant's `signature_requests.access_token_hash`. A tampered or foreign
 * tenant id in the prefix simply hashes to something that matches no row in
 * whatever tenant it now points at — there is no path from "guess a tenant
 * id" to "read another tenant's request," because the secret half of the
 * token must still match exactly.
 */
function buildRawToken(tenantId: string, secret: string): string {
  return `${tenantId}.${secret}`
}

function parseRawToken(rawToken: string): { tenantId: string; hash: string } | null {
  const dot = rawToken.indexOf('.')
  if (dot <= 0 || dot === rawToken.length - 1) return null
  const tenantId = rawToken.slice(0, dot)
  if (!UUID_RE.test(tenantId)) return null
  return { tenantId, hash: hashToken(rawToken) }
}

/* ── Integrity seal ──────────────────────────────────────────────────────── */

/**
 * The exact fields sealed into `integritySeal`, in the fixed order the HMAC
 * is computed over. This is a compatibility contract — see `buildSealInput`.
 */
export interface SealInputFields {
  templateContentHash: string
  templateVersion: number
  documentSha256: string
  signatureSha256: string
  consentCopyHash: string
  signerLegalName: string
  signerEmail: string
  signerUserId: string | null
  tenantId: string
  requestId: string
  /** ISO-8601 with millisecond precision, e.g. `new Date().toISOString()`. */
  signedAt: Date
}

/**
 * `JSON.stringify` of a fixed-order, 11-element tuple:
 *
 *   [ "v1", templateContentHash, templateVersion, documentSha256,
 *     signatureSha256, consentCopyHash, signerLegalName, signerEmail,
 *     signerUserId ?? "", tenantId, requestId, signedAt.toISOString() ]
 *
 * This is a compatibility contract, not an implementation detail: any tool
 * that independently re-verifies a signature record — a court exhibit
 * script, a future export format — must reproduce exactly this string from
 * the record's stored columns and the request's pinned template fields, then
 * `HMAC-SHA256` it with `SIGNATURE_HASH_PEPPER` to get `integritySeal`. Using
 * `JSON.stringify` on an array (never on an object) means the encoding is
 * order-independent-by-construction: there is no property-enumeration order
 * to depend on, only positional array order, which this function fixes
 * permanently under the `"v1"` tag. A future format change must bump that
 * tag rather than silently reinterpret existing seals.
 */
export function buildSealInput(fields: SealInputFields): string {
  return JSON.stringify([
    'v1',
    fields.templateContentHash,
    fields.templateVersion,
    fields.documentSha256,
    fields.signatureSha256,
    fields.consentCopyHash,
    fields.signerLegalName,
    fields.signerEmail,
    fields.signerUserId ?? '',
    fields.tenantId,
    fields.requestId,
    fields.signedAt.toISOString(),
  ])
}

export function computeIntegritySeal(fields: SealInputFields): string {
  return hmacHex(buildSealInput(fields), serverEnv().SIGNATURE_HASH_PEPPER)
}

/* ── Signature capture validation ────────────────────────────────────────── */

export interface SignatureCaptureInput {
  method: 'drawn' | 'typed'
  /** Client-reported result of `SignaturePad.hasDrawn()` — only meaningful when `method === 'drawn'`. */
  hasDrawnStrokes: boolean
  typedName: string | null
  /** PNG data URL from `SignaturePad.toDataUrl()`. */
  dataUrl: string | null
}

/**
 * Refuses a signature that is not real: an empty canvas (no strokes) in draw
 * mode, or a blank/whitespace name in type mode. This is checked server-side
 * even though the signature pad already enforces it client-side, because the
 * client's word is not a security boundary — the resulting artifact is a
 * legal document.
 */
export function assertRealSignatureCapture(input: SignatureCaptureInput): void {
  if (input.method === 'typed') {
    if (!input.typedName || input.typedName.trim().length === 0) {
      throw validationFailed('signature.errors.typedNameRequired')
    }
  } else if (!input.hasDrawnStrokes) {
    throw validationFailed('signature.errors.signatureRequired')
  }

  if (!input.dataUrl) {
    throw validationFailed('signature.errors.signatureRequired')
  }
}

const PNG_DATA_URL_RE = /^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/

function decodeSignaturePng(dataUrl: string): Buffer {
  const match = PNG_DATA_URL_RE.exec(dataUrl.trim())
  if (!match?.[1]) throw validationFailed('signature.errors.signatureRequired')
  const bytes = Buffer.from(match[1], 'base64')
  const sniffed = sniffMimeType(bytes)
  if (!sniffed || sniffed.mimeType !== 'image/png') {
    throw validationFailed('signature.errors.signatureRequired')
  }
  return bytes
}

/* ── Request status guards ───────────────────────────────────────────────── */

/** Throws a distinct, translatable error for every terminal or expired state a signer link can be in. */
export function assertRequestIsResolvable(request: SignatureRequest): void {
  if (request.expiresAt && request.expiresAt.getTime() < Date.now() && request.status !== 'signed') {
    throw conflict('signature.errors.linkExpired')
  }
  switch (request.status) {
    case 'signed':
      throw conflict('signature.errors.alreadySigned')
    case 'declined':
      throw conflict('signature.errors.declined')
    case 'voided':
      throw conflict('signature.errors.voided')
    case 'superseded':
      throw conflict('signature.errors.superseded')
    case 'expired':
      throw conflict('signature.errors.linkExpired')
    default:
      return
  }
}

/* ── System actor for the document service ──────────────────────────────── */

/**
 * The document service requires a full `Actor` even though it only reads
 * `actor.userId` for bookkeeping (`uploadedByUserId`). The signing ceremony
 * has no logged-in staff member in the loop by the time a document is
 * generated — the signer may hold nothing but a token — so the id used here
 * is always `requestedByUserId`: the staff member who sent the request, and
 * therefore a real, tenant-scoped `users.id` the foreign key can reference.
 * The signer's own identity is fully captured on `signatureRecords`
 * (`signerLegalName`, `signerEmail`, `signerUserId`) and in the ceremony log
 * — this actor is bookkeeping only, never the record of who signed.
 */
export function documentActorFor(tenantId: string, userId: string, locale: Locale): Actor {
  return {
    userId,
    email: 'signatures@internal.goliathdispatch.com',
    firstName: 'Signature',
    lastName: 'Ceremony',
    locale,
    timezone: 'UTC',
    isPlatformSuperAdmin: false,
    tenantId,
    role: null,
    carrierId: null,
    driverId: null,
    assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: null,
  }
}

function documentTypeForTemplateKey(templateKey: string): (typeof documents.documentType.enumValues)[number] {
  const values = documents.documentType.enumValues as readonly string[]
  return (values.includes(templateKey) ? templateKey : 'other') as (typeof documents.documentType.enumValues)[number]
}

/** Wraps `appendSignatureAuditEvent` in its own transaction for call sites outside an existing one. */
export async function recordCeremonyEvent(
  db: TenantDb,
  input: {
    requestId: string
    recordId?: string | null
    eventType: SignatureEventType
    actorUserId?: string | null
    actorEmail?: string | null
    ipAddress?: string | null
    userAgent?: string | null
    detail?: Record<string, unknown> | null
  },
): Promise<SignatureAuditEvent> {
  return db.transaction((tx) => appendSignatureAuditEvent(tx, input))
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/* ── Create request ──────────────────────────────────────────────────────── */

export interface CreateSignatureRequestInput {
  templateKey: string
  subjectType: 'carrier' | 'load' | 'tenant'
  subjectId: string
  carrierId?: string | null
  signerUserId?: string | null
  signerEmail: string
  locale: Locale
  tokenValues: Record<string, string>
  /** Omit for no expiry. */
  expiresInDays?: number
  requestedByUserId: string
}

export interface CreateSignatureRequestResult {
  request: SignatureRequest
  /** Returned exactly once — only the SHA-256 of this is ever persisted. */
  rawToken: string
}

export async function createSignatureRequest(
  db: TenantDb,
  input: CreateSignatureRequestInput,
): Promise<CreateSignatureRequestResult> {
  const template = await getActiveTemplate(db, input.templateKey)
  if (!template) throw notFound('signature.errors.templateNotFound', { templateKey: input.templateKey })

  // Fail fast: a request pinned to tokens that cannot render is a defect at
  // creation time, not a surprise the signer discovers on the link.
  renderTemplate(template, input.tokenValues, input.locale)

  const rawToken = buildRawToken(db.tenantId, generateToken(32))
  const accessTokenHash = hashToken(rawToken)
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null
  const carrierId = input.carrierId ?? (input.subjectType === 'carrier' ? input.subjectId : null)

  const request = await db.transaction(async (tx) => {
    const created = await tx.insert(signatureRequests, {
      templateId: template.id,
      templateVersion: template.version,
      templateContentHash: template.contentHash,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      carrierId,
      signerUserId: input.signerUserId ?? null,
      signerEmail: input.signerEmail,
      locale: input.locale,
      status: 'pending',
      tokenValues: input.tokenValues,
      accessTokenHash,
      requestedByUserId: input.requestedByUserId,
      expiresAt,
    })

    await appendSignatureAuditEvent(tx, {
      requestId: created.id,
      eventType: 'requested',
      actorUserId: input.requestedByUserId,
    })

    return created
  })

  const emailed = await sendSignatureRequestEmail(db, request, rawToken, template).catch((error: unknown) => {
    logger.error('Failed to email signature request', { requestId: request.id, error })
    return false
  })
  if (emailed) {
    await recordCeremonyEvent(db, { requestId: request.id, eventType: 'emailed' })
  }

  return { request, rawToken }
}

async function sendSignatureRequestEmail(
  db: TenantDb,
  request: SignatureRequest,
  rawToken: string,
  template: SignatureTemplate,
): Promise<boolean> {
  const [tenant, branding] = await Promise.all([
    getTenant(db.tenantId),
    db.findFirst(tenantBranding),
  ])
  const tenantName = tenant?.displayName ?? 'Goliath Dispatch'
  const dictionary = await getDictionary(request.locale, ['signature', 'common'])
  const t = createTranslator(dictionary, request.locale)
  const rendered = renderTemplate(template, request.tokenValues, request.locale)
  const link = `${publicEnv.NEXT_PUBLIC_APP_URL}/${request.locale}/sign/${rawToken}`

  const introText = t('signature.email.requestBody', { title: rendered.title, tenant: tenantName })
  const cta = t('signature.email.requestCta')
  const bodyHtml = `<p>${escapeHtml(introText)}</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 20px;background:#062B5C;color:#ffffff;border-radius:6px;text-decoration:none;">${escapeHtml(cta)}</a></p>`
  const bodyText = `${introText}\n\n${link}`

  const shell = renderEmailShell({
    locale: request.locale,
    branding: { tenantDisplayName: tenantName, primaryColorHex: branding?.primaryColor ?? null },
    bodyHtml,
    bodyText,
  })

  await getEmailProvider().send({
    to: request.signerEmail,
    subject: t('signature.email.requestSubject', { tenant: tenantName }),
    html: shell.html,
    text: shell.text,
    tags: ['signature-request'],
  })
  return true
}

/* ── Resolve by token ─────────────────────────────────────────────────────── */

export interface ResolvedSignatureRequest {
  request: SignatureRequest
  template: SignatureTemplate
}

export async function resolveSignatureRequestByToken(rawToken: string): Promise<ResolvedSignatureRequest> {
  const tokenHash = hashToken(rawToken)
  const rate = await checkRateLimit(rateLimitPolicies.signatureLinkAccess(tokenHash))
  if (!rate.allowed) throw new AppError('rate_limited', 'errors.rateLimited')

  const parsed = parseRawToken(rawToken)
  if (!parsed) throw notFound('signature.errors.linkInvalid')

  const db = tenantDb(parsed.tenantId)
  const request = await db.findFirst(signatureRequests, {
    where: eq(signatureRequests.accessTokenHash, parsed.hash),
  })
  if (!request || !safeEqual(request.accessTokenHash ?? '', parsed.hash)) {
    throw notFound('signature.errors.linkInvalid')
  }

  assertRequestIsResolvable(request)

  const template = await db.requireById(signatureTemplates, request.templateId, 'signatureTemplate')
  return { request, template }
}

/**
 * The same token-based lookup as `resolveSignatureRequestByToken`, but for
 * the confirmation screen *after* a successful signature — where `status ===
 * 'signed'` is exactly the state that function otherwise rejects. Used only
 * to hand the signer back their own two documents; it never exposes anything
 * beyond what `signDocument` already returned to the same browser.
 */
export async function resolveSignedRequestForDownload(
  rawToken: string,
): Promise<{ request: SignatureRequest; record: SignatureRecord }> {
  const tokenHash = hashToken(rawToken)
  const rate = await checkRateLimit(rateLimitPolicies.signatureLinkAccess(tokenHash))
  if (!rate.allowed) throw new AppError('rate_limited', 'errors.rateLimited')

  const parsed = parseRawToken(rawToken)
  if (!parsed) throw notFound('signature.errors.linkInvalid')

  const db = tenantDb(parsed.tenantId)
  const request = await db.findFirst(signatureRequests, {
    where: eq(signatureRequests.accessTokenHash, parsed.hash),
  })
  if (!request || !safeEqual(request.accessTokenHash ?? '', parsed.hash) || request.status !== 'signed') {
    throw notFound('signature.errors.linkInvalid')
  }

  const record = await db.findFirst(signatureRecords, { where: eq(signatureRecords.requestId, request.id) })
  if (!record) throw notFound('signature.errors.requestNotFound')

  return { request, record }
}

/* ── View tracking ────────────────────────────────────────────────────────── */

export interface RecordViewInput {
  requestId: string
  eventType: 'opened' | 'viewed'
  ipAddress?: string | null
  userAgent?: string | null
}

export async function recordView(db: TenantDb, input: RecordViewInput): Promise<void> {
  await db.transaction(async (tx) => {
    const request = await tx.requireById(signatureRequests, input.requestId, 'signatureRequest')
    await appendSignatureAuditEvent(tx, {
      requestId: input.requestId,
      eventType: input.eventType,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    })
    if (!request.firstViewedAt) {
      await tx.update(signatureRequests, request.id, {
        firstViewedAt: new Date(),
        status: request.status === 'pending' ? 'viewed' : request.status,
      })
    }
  })
}

/* ── Sign ─────────────────────────────────────────────────────────────────── */

export interface SignDocumentInput {
  requestId: string
  signerLegalName: string
  signerTitle?: string | null
  method: 'drawn' | 'typed'
  signatureDataUrl: string | null
  typedName?: string | null
  hasDrawnStrokes: boolean
  consentAccepted: boolean
  locale: Locale
  ip: string
  userAgent: string
  actorUserId?: string | null
}

export interface SignDocumentResult {
  record: SignatureRecord
  request: SignatureRequest
}

export async function signDocument(db: TenantDb, input: SignDocumentInput): Promise<SignDocumentResult> {
  if (!input.consentAccepted) {
    throw validationFailed('signature.errors.consentRequired')
  }
  if (!input.signerLegalName.trim()) {
    throw validationFailed('signature.errors.legalNameRequired')
  }
  assertRealSignatureCapture({
    method: input.method,
    hasDrawnStrokes: input.hasDrawnStrokes,
    typedName: input.typedName ?? null,
    dataUrl: input.signatureDataUrl,
  })

  const signatureBytes = decodeSignaturePng(input.signatureDataUrl!)
  const signatureSha256 = sha256Hex(signatureBytes)

  const { record, request, pdfBytes } = await db.transaction(async (tx) => {
    const request = await lockRequest(tx, input.requestId)
    assertRequestIsResolvable(request)

    const template = await tx.requireById(signatureTemplates, request.templateId, 'signatureTemplate')
    const rendered = renderTemplate(template, request.tokenValues, input.locale)
    const consentCopyHash = sha256Hex(rendered.consentCopy)

    const signatureKey = `tenants/${tx.tenantId}/signatures/${request.id}/signature.png`
    assertKeyBelongsToTenant(signatureKey, tx.tenantId)
    await getStorage().put({ key: signatureKey, body: signatureBytes, contentType: 'image/png' })

    const tenant = await getTenant(tx.tenantId)
    const pdfDictionary = await getDictionary(input.locale, ['document'])
    const pdfT = createTranslator(pdfDictionary, input.locale)

    const pdfBytes = await renderSignedAgreementPdf(
      {
        tenantName: tenant?.displayName ?? 'Goliath Dispatch',
        documentTitle: rendered.title,
        bodyText: rendered.body,
        signatureImageBytes: signatureBytes,
        signatureImageContentType: 'image/png',
        consentCopy: rendered.consentCopy,
        signer: {
          legalName: input.signerLegalName,
          title: input.signerTitle ?? null,
          email: request.signerEmail,
          signedAt: new Date(),
          ipAddress: input.ip,
          timezone: tenant?.defaultTimezone ?? 'America/New_York',
        },
      },
      input.locale,
      pdfT,
    )
    const documentSha256 = sha256Hex(pdfBytes)

    const documentUploaderId = request.requestedByUserId ?? input.actorUserId ?? request.signerUserId
    if (!documentUploaderId) {
      throw new AppError('internal', 'errors.internal', {
        detail: 'signature request has no requestedByUserId, actorUserId or signerUserId to attribute the document to',
      })
    }
    const documentActor = documentActorFor(tx.tenantId, documentUploaderId, input.locale)
    const { document } = await uploadDocumentService(tx, documentActor, {
      ownerType: request.subjectType as DocumentOwnerType,
      ownerId: request.subjectId,
      documentType: documentTypeForTemplateKey(template.templateKey),
      title: rendered.title,
      originalFilename: `${template.templateKey}-signed.pdf`,
      bytes: Buffer.from(pdfBytes),
      policy: DOCUMENT_UPLOAD_POLICY,
    })

    const signedAt = new Date()
    const integritySeal = computeIntegritySeal({
      templateContentHash: request.templateContentHash,
      templateVersion: request.templateVersion,
      documentSha256,
      signatureSha256,
      consentCopyHash,
      signerLegalName: input.signerLegalName,
      signerEmail: request.signerEmail,
      signerUserId: input.actorUserId ?? request.signerUserId ?? null,
      tenantId: tx.tenantId,
      requestId: request.id,
      signedAt,
    })

    const record = await tx.insert(signatureRecords, {
      requestId: request.id,
      signerUserId: input.actorUserId ?? request.signerUserId ?? null,
      signerLegalName: input.signerLegalName,
      signerEmail: request.signerEmail,
      signerTitle: input.signerTitle ?? null,
      method: input.method,
      signatureStorageKey: signatureKey,
      signatureSha256,
      typedNameValue: input.method === 'typed' ? (input.typedName ?? null) : null,
      consentAccepted: true,
      consentCopyHash,
      documentSha256,
      signedDocumentId: document.id,
      auditCertificateDocumentId: null,
      integritySeal,
      sealAlgorithm: 'HMAC-SHA256',
      ipAddress: input.ip,
      userAgent: input.userAgent,
      locale: input.locale,
      signedAt,
    })

    await tx.update(signatureRequests, request.id, {
      status: 'signed',
      completedAt: signedAt,
      signerLegalName: input.signerLegalName,
    })

    await appendSignatureAuditEvent(tx, {
      requestId: request.id,
      recordId: record.id,
      eventType: 'consent_accepted',
      ipAddress: input.ip,
      userAgent: input.userAgent,
    })
    await appendSignatureAuditEvent(tx, {
      requestId: request.id,
      recordId: record.id,
      eventType: 'signature_captured',
      ipAddress: input.ip,
      userAgent: input.userAgent,
      detail: { method: input.method },
    })
    await appendSignatureAuditEvent(tx, {
      requestId: request.id,
      recordId: record.id,
      eventType: 'document_generated',
      detail: { documentId: document.id },
    })
    await appendSignatureAuditEvent(tx, {
      requestId: request.id,
      recordId: record.id,
      eventType: 'sealed',
      detail: { sealAlgorithm: 'HMAC-SHA256' },
    })

    return { record, request: { ...request, status: 'signed' as const }, pdfBytes }
  })

  // Everything the tamper-evident guarantee depends on is now durable. The
  // audit certificate is a convenience artifact summarizing it — if anything
  // below fails, the signed request and its record already exist intact.
  const finalRecord = await generateAndAttachCertificate(db, request, record, pdfBytes).catch(
    (error: unknown) => {
      logger.error('Failed to generate/email signature audit certificate', { requestId: request.id, error })
      return record
    },
  )

  return { record: finalRecord, request }
}

async function lockRequest(tx: TenantDb, requestId: string): Promise<SignatureRequest> {
  const rows = await tx.builderRequiringExplicitTenantPredicate
    .select()
    .from(signatureRequests)
    .where(eq(signatureRequests.id, requestId))
    .for('update')
  const request = rows[0]
  if (!request || request.tenantId !== tx.tenantId) {
    throw notFound('signature.errors.requestNotFound')
  }
  return request
}

async function generateAndAttachCertificate(
  db: TenantDb,
  request: SignatureRequest,
  record: SignatureRecord,
  pdfBytes: Uint8Array,
): Promise<SignatureRecord> {
  const [tenant, events] = await Promise.all([getTenant(db.tenantId), listAuditEventsForRequest(db, request.id)])
  const dictionary = await getDictionary(request.locale, ['document'])
  const t = createTranslator(dictionary, request.locale)

  const certificateBytes = await renderAuditCertificatePdf(
    {
      tenantName: tenant?.displayName ?? 'Goliath Dispatch',
      timezone: tenant?.defaultTimezone ?? 'America/New_York',
      requestId: request.id,
      subjectDescription: `${request.subjectType} ${request.subjectId}`,
      templateKey: (await db.requireById(signatureTemplates, request.templateId, 'signatureTemplate')).templateKey,
      templateVersion: request.templateVersion,
      templateContentHash: request.templateContentHash,
      documentSha256: record.documentSha256,
      signatureSha256: record.signatureSha256,
      integritySeal: record.integritySeal,
      sealAlgorithm: record.sealAlgorithm,
      signer: { legalName: record.signerLegalName, email: record.signerEmail, signedAt: record.signedAt },
      events: events.map((event) => ({
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        actorEmail: event.actorEmail,
        ipAddress: event.ipAddress,
        eventHash: event.eventHash,
      })),
    },
    request.locale,
    t,
  )

  const documentUploaderId = request.requestedByUserId ?? record.signerUserId
  if (!documentUploaderId) {
    throw new AppError('internal', 'errors.internal', {
      detail: 'signature request has no requestedByUserId or signerUserId to attribute the certificate document to',
    })
  }
  const documentActor = documentActorFor(db.tenantId, documentUploaderId, request.locale)
  const { document: certificateDocument } = await uploadDocumentService(db, documentActor, {
    ownerType: request.subjectType as DocumentOwnerType,
    ownerId: request.subjectId,
    documentType: 'other',
    title: t('document.pdf.auditCertificateTitle'),
    originalFilename: `signature-audit-certificate-${request.id}.pdf`,
    bytes: Buffer.from(certificateBytes),
    policy: DOCUMENT_UPLOAD_POLICY,
  })

  const updatedRecord =
    (await db.update(signatureRecords, record.id, { auditCertificateDocumentId: certificateDocument.id })) ?? record

  const emailed = await sendSignedCopyEmail(db, request, Buffer.from(pdfBytes), Buffer.from(certificateBytes)).catch(
    (error: unknown) => {
      logger.error('Failed to email signed copy', { requestId: request.id, error })
      return false
    },
  )
  if (emailed) {
    await recordCeremonyEvent(db, { requestId: request.id, recordId: record.id, eventType: 'emailed_copy' })
  }

  return updatedRecord
}

async function sendSignedCopyEmail(
  db: TenantDb,
  request: SignatureRequest,
  pdfBytes: Buffer,
  certificateBytes: Buffer,
): Promise<boolean> {
  const tenant = await getTenant(db.tenantId)
  const tenantName = tenant?.displayName ?? 'Goliath Dispatch'
  const dictionary = await getDictionary(request.locale, ['signature'])
  const t = createTranslator(dictionary, request.locale)

  const introText = t('signature.email.signedCopyBody', { tenant: tenantName })
  const shell = renderEmailShell({
    locale: request.locale,
    branding: { tenantDisplayName: tenantName },
    bodyHtml: `<p>${escapeHtml(introText)}</p>`,
    bodyText: introText,
  })

  await getEmailProvider().send({
    to: request.signerEmail,
    subject: t('signature.email.signedCopySubject', { tenant: tenantName }),
    html: shell.html,
    text: shell.text,
    tags: ['signature-copy'],
    attachments: [
      { filename: 'signed-agreement.pdf', contentType: 'application/pdf', content: pdfBytes },
      { filename: 'audit-certificate.pdf', contentType: 'application/pdf', content: certificateBytes },
    ],
  })
  return true
}

/* ── Decline / void ───────────────────────────────────────────────────────── */

export interface DeclineSignatureInput {
  requestId: string
  reason: string
  ipAddress?: string | null
  userAgent?: string | null
  actorUserId?: string | null
  actorEmail?: string | null
}

export async function declineSignature(db: TenantDb, input: DeclineSignatureInput): Promise<SignatureRequest> {
  if (!input.reason.trim()) throw validationFailed('signature.errors.reasonRequired')

  return db.transaction(async (tx) => {
    const request = await lockRequest(tx, input.requestId)
    assertRequestIsResolvable(request)

    const updated = await tx.update(signatureRequests, request.id, {
      status: 'declined',
      declinedAt: new Date(),
      declineReason: input.reason,
    })
    await appendSignatureAuditEvent(tx, {
      requestId: request.id,
      eventType: 'declined',
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      detail: { reason: input.reason },
    })
    return updated!
  })
}

export interface VoidSignatureRequestInput {
  requestId: string
  reason: string
  actorUserId: string
}

export async function voidSignatureRequest(db: TenantDb, input: VoidSignatureRequestInput): Promise<SignatureRequest> {
  if (!input.reason.trim()) throw validationFailed('signature.errors.reasonRequired')

  return db.transaction(async (tx) => {
    const request = await lockRequest(tx, input.requestId)
    if (request.status === 'signed') {
      throw conflict('signature.errors.cannotVoidSigned')
    }
    if (request.status === 'voided') {
      throw conflict('signature.errors.voided')
    }

    const updated = await tx.update(signatureRequests, request.id, {
      status: 'voided',
      voidedAt: new Date(),
      voidReason: input.reason,
    })
    await appendSignatureAuditEvent(tx, {
      requestId: request.id,
      eventType: 'voided',
      actorUserId: input.actorUserId,
      detail: { reason: input.reason },
    })
    return updated!
  })
}

/* ── Integrity verification ──────────────────────────────────────────────── */

export interface VerifyIntegrityResult {
  sealValid: boolean
  documentHashValid: boolean
  chainValid: boolean
  brokenAtEventId?: string
}

/**
 * Recomputes the integrity seal from the record's stored components (and the
 * request's pinned template fields), re-hashes the *current* bytes of the
 * stored signed PDF, and re-walks the request's full audit-event chain. This
 * is the function that turns "tamper-evident" into something demonstrable:
 * it never trusts a stored flag, only recomputation.
 */
export async function verifyIntegrity(db: TenantDb, recordId: string): Promise<VerifyIntegrityResult> {
  const record = await db.requireById(signatureRecords, recordId, 'signatureRecord')
  const request = await db.requireById(signatureRequests, record.requestId, 'signatureRequest')

  const recomputedSeal = computeIntegritySeal({
    templateContentHash: request.templateContentHash,
    templateVersion: request.templateVersion,
    documentSha256: record.documentSha256,
    signatureSha256: record.signatureSha256,
    consentCopyHash: record.consentCopyHash,
    signerLegalName: record.signerLegalName,
    signerEmail: record.signerEmail,
    signerUserId: record.signerUserId,
    tenantId: record.tenantId,
    requestId: record.requestId,
    signedAt: record.signedAt,
  })
  const sealValid = safeEqual(recomputedSeal, record.integritySeal)

  let documentHashValid = false
  if (record.signedDocumentId) {
    try {
      const document = await db.findById(documents, record.signedDocumentId)
      if (document?.currentVersionId) {
        const version = await db.findById(documentVersions, document.currentVersionId)
        if (version) {
          assertKeyBelongsToTenant(version.storageKey, db.tenantId)
          const stored = await getStorage().get(version.storageKey)
          documentHashValid = safeEqual(sha256Hex(stored.body), record.documentSha256)
        }
      }
    } catch (error) {
      logger.error('Failed to re-verify signed document bytes', { recordId, error })
      documentHashValid = false
    }
  }

  const events = await listAuditEventsForRequest(db, record.requestId)
  const chain = verifyChain(events)

  return {
    sealValid,
    documentHashValid,
    chainValid: chain.valid,
    brokenAtEventId: chain.brokenAtEventId,
  }
}
