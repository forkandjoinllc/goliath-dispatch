import 'server-only'
import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm'
import { TenantDb } from '@/db/tenant-db'
import {
  documentAccessLogs,
  documentExpirations,
  documentReviews,
  documentVersions,
  documents,
  jobQueue,
  tenantSettings,
  type Document,
  type DocumentReview,
  type DocumentVersion,
} from '@/db/schema'
import { AppError, notFound } from '@/lib/errors'
import { newId, sha256Hex } from '@/lib/crypto'
import type { Actor } from '@/lib/permissions'
import type { Locale } from '@/i18n/config'
import type { TranslateFn } from '@/i18n/translate'
import {
  DOCUMENT_UPLOAD_POLICY,
  type DocumentOwnerType,
  type UploadPolicy,
  assertKeyBelongsToTenant,
  buildKey,
  getMalwareScanner,
  getStorage,
  sanitizeFilename,
  validateUpload,
} from '@/lib/storage'
import { watermarkImage, watermarkPdf } from '@/lib/pdf/watermark'

/**
 * The document service.
 *
 * Every mutating function here is the business-rule layer beneath
 * `actions.ts` — it never checks permissions itself (that already happened in
 * `defineAction`/the route handler) but it is the last line of defence on
 * tenant isolation: every storage key it hands to a driver has already been
 * built from the caller's own `db.tenantId`, and every key it reads back off
 * a row is re-verified with `assertKeyBelongsToTenant` before use.
 */

/** OCR/VIN extraction only runs for the one document type the compliance gate reads. */
const OCR_ELIGIBLE_TYPES = new Set(['certificate_of_insurance'])

async function warningDaysFor(db: TenantDb): Promise<number> {
  const settings = await db.findFirst(tenantSettings)
  return settings?.documentExpirationWarningDays ?? 30
}

function computeExpiresSoonAt(expirationDate: Date | null | undefined, warningDays: number): Date | null {
  if (!expirationDate) return null
  const soon = new Date(expirationDate)
  soon.setUTCDate(soon.getUTCDate() - warningDays)
  return soon
}

async function enqueueOcrJob(db: TenantDb, documentId: string, documentVersionId: string): Promise<void> {
  const dedupeKey = `document.ocr_extract:${documentVersionId}`
  const alreadyQueued = await db.exists(jobQueue, eq(jobQueue.dedupeKey, dedupeKey))
  if (alreadyQueued) return
  await db.insert(jobQueue, {
    jobType: 'document.ocr_extract',
    payload: { documentId, documentVersionId },
    dedupeKey,
  })
}

async function persistVersionBytes(
  db: TenantDb,
  input: { ownerType: DocumentOwnerType; ownerId: string; documentId: string; versionNumber: number; originalFilename: string },
  bytes: Buffer,
  policy: UploadPolicy,
): Promise<{ key: string; contentType: string; sha256: string }> {
  const sniffed = validateUpload(bytes, policy)

  const scanner = getMalwareScanner()
  const scanResult = await scanner.scan(bytes)
  if (!scanResult.clean) {
    throw new AppError('validation_failed', 'errors.malwareDetected', {
      detail: { signature: scanResult.signature },
    })
  }

  const key = buildKey({
    tenantId: db.tenantId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    documentId: input.documentId,
    versionNumber: input.versionNumber,
    filename: input.originalFilename,
  })
  assertKeyBelongsToTenant(key, db.tenantId)

  await getStorage().put({ key, body: bytes, contentType: sniffed.mimeType })

  return { key, contentType: sniffed.mimeType, sha256: sha256Hex(bytes) }
}

/* ── Upload ──────────────────────────────────────────────────────────────── */

export interface UploadDocumentInput {
  ownerType: DocumentOwnerType
  ownerId: string
  documentType: (typeof documents.documentType.enumValues)[number]
  title?: string | null
  description?: string | null
  issueDate?: Date | null
  expirationDate?: Date | null
  isRequired?: boolean
  originalFilename: string
  bytes: Buffer
  /** Defaults to the 15 MB PDF/JPG/PNG document policy; equipment media passes `MEDIA_UPLOAD_POLICY`. */
  policy?: UploadPolicy
}

export interface UploadDocumentResult {
  document: Document
  version: DocumentVersion
}

export async function uploadDocument(
  db: TenantDb,
  actor: Actor,
  input: UploadDocumentInput,
): Promise<UploadDocumentResult> {
  const policy = input.policy ?? DOCUMENT_UPLOAD_POLICY
  const warningDays = await warningDaysFor(db)

  return db.transaction(async (tx) => {
    const document = await tx.insert(documents, {
      documentType: input.documentType,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      title: input.title ?? null,
      description: input.description ?? null,
      reviewStatus: 'pending',
      issueDate: input.issueDate ?? null,
      expirationDate: input.expirationDate ?? null,
      isRequired: input.isRequired ?? false,
      expiresSoonAt: computeExpiresSoonAt(input.expirationDate, warningDays),
      uploadedByUserId: actor.userId,
    })

    const versionNumber = 1
    const persisted = await persistVersionBytes(
      tx,
      {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        documentId: document.id,
        versionNumber,
        originalFilename: input.originalFilename,
      },
      input.bytes,
      policy,
    )

    const version = await tx.insert(documentVersions, {
      documentId: document.id,
      versionNumber,
      storageKey: persisted.key,
      originalFilename: sanitizeFilename(input.originalFilename),
      contentType: persisted.contentType,
      byteSize: input.bytes.byteLength,
      sha256: persisted.sha256,
      malwareScanStatus: 'clean',
      malwareScanAt: new Date(),
      extractionStatus: OCR_ELIGIBLE_TYPES.has(input.documentType) ? 'queued' : 'not_started',
      uploadedByUserId: actor.userId,
    })

    const updated = await tx.update(documents, document.id, { currentVersionId: version.id })

    if (OCR_ELIGIBLE_TYPES.has(input.documentType)) {
      await enqueueOcrJob(tx, document.id, version.id)
    }

    return { document: updated ?? document, version }
  })
}

/* ── New version ─────────────────────────────────────────────────────────── */

export interface AddVersionInput {
  documentId: string
  originalFilename: string
  bytes: Buffer
  policy?: UploadPolicy
}

export async function addVersion(
  db: TenantDb,
  actor: Actor,
  input: AddVersionInput,
): Promise<UploadDocumentResult> {
  const policy = input.policy ?? DOCUMENT_UPLOAD_POLICY

  return db.transaction(async (tx) => {
    const document = await tx.requireById(documents, input.documentId, 'document')
    const versionCount = await tx.count(documentVersions, eq(documentVersions.documentId, document.id))
    const versionNumber = versionCount + 1

    const persisted = await persistVersionBytes(
      tx,
      {
        ownerType: document.ownerType as DocumentOwnerType,
        ownerId: document.ownerId,
        documentId: document.id,
        versionNumber,
        originalFilename: input.originalFilename,
      },
      input.bytes,
      policy,
    )

    const version = await tx.insert(documentVersions, {
      documentId: document.id,
      versionNumber,
      storageKey: persisted.key,
      originalFilename: sanitizeFilename(input.originalFilename),
      contentType: persisted.contentType,
      byteSize: input.bytes.byteLength,
      sha256: persisted.sha256,
      malwareScanStatus: 'clean',
      malwareScanAt: new Date(),
      extractionStatus: OCR_ELIGIBLE_TYPES.has(document.documentType) ? 'queued' : 'not_started',
      uploadedByUserId: actor.userId,
    })

    // A new version invalidates whatever review happened on the last one.
    const updated = await tx.update(documents, document.id, {
      currentVersionId: version.id,
      reviewStatus: 'pending',
    })

    if (OCR_ELIGIBLE_TYPES.has(document.documentType)) {
      await enqueueOcrJob(tx, document.id, version.id)
    }

    return { document: updated ?? document, version }
  })
}

/* ── Review ──────────────────────────────────────────────────────────────── */

export interface ReviewDocumentInput {
  documentId: string
  status: 'approved' | 'rejected'
  notes?: string | null
  rejectionReason?: string | null
}

export interface ReviewDocumentResult {
  document: Document
  review: DocumentReview
}

export async function reviewDocument(
  db: TenantDb,
  actor: Actor,
  input: ReviewDocumentInput,
): Promise<ReviewDocumentResult> {
  if (input.status === 'rejected' && !input.rejectionReason?.trim()) {
    throw new AppError('validation_failed', 'document.errors.rejectionReasonRequired')
  }

  return db.transaction(async (tx) => {
    const document = await tx.requireById(documents, input.documentId, 'document')
    if (!document.currentVersionId) {
      throw notFound('document.errors.versionNotFound')
    }

    const review = await tx.insert(documentReviews, {
      documentId: document.id,
      documentVersionId: document.currentVersionId,
      status: input.status,
      reviewerUserId: actor.userId,
      notes: input.notes ?? null,
      rejectionReason: input.status === 'rejected' ? (input.rejectionReason ?? null) : null,
    })

    const updated = await tx.update(documents, document.id, { reviewStatus: input.status })
    return { document: updated ?? document, review }
  })
}

/* ── Download ────────────────────────────────────────────────────────────── */

export interface DownloadBrandContext {
  tenantName: string
  timezone: string
  logoPngBytes?: Uint8Array | null
}

export interface GetDownloadUrlInput {
  documentId: string
  /** Defaults to the document's current version — pass a prior version's id to download superseded history from the version list. */
  versionId?: string
  watermark?: boolean
  action?: 'view' | 'download' | 'print'
}

export interface GetDownloadUrlResult {
  url: string
  watermarked: boolean
  document: Document
  version: DocumentVersion
}

const WATERMARKED_URL_TTL_SECONDS = 90

export async function getDownloadUrl(
  db: TenantDb,
  actor: Actor,
  request: { ipAddress: string | null; userAgent: string | null },
  input: GetDownloadUrlInput,
  brand: DownloadBrandContext,
  t: TranslateFn,
  locale: Locale,
): Promise<GetDownloadUrlResult> {
  const document = await db.requireById(documents, input.documentId, 'document')
  const targetVersionId = input.versionId ?? document.currentVersionId
  if (!targetVersionId) {
    throw notFound('document.errors.versionNotFound')
  }
  const version = await db.requireById(documentVersions, targetVersionId, 'documentVersion')
  // A version id travels from the client — prove it actually belongs to
  // this document before ever signing a URL for it, the same way every
  // other resource-scoped lookup re-verifies rather than trusting the id.
  if (version.documentId !== document.id) {
    throw notFound('document.errors.versionNotFound')
  }

  // The document row is trusted (it came from a tenant-scoped query), but the
  // storage key travels through more hands — re-verify at the point of use.
  assertKeyBelongsToTenant(version.storageKey, db.tenantId)

  const storage = getStorage()
  let url: string
  let watermarked = false

  if (input.watermark) {
    const original = await storage.get(version.storageKey)
    const stampOptions = {
      downloadedAt: new Date(),
      locale,
      tenantName: brand.tenantName,
      timezone: brand.timezone,
      downloadedByEmail: actor.email,
    }

    let stampedBytes: Uint8Array
    if (version.contentType === 'application/pdf') {
      stampedBytes = await watermarkPdf(original.body, stampOptions, t)
    } else if (version.contentType === 'image/png' || version.contentType === 'image/jpeg') {
      stampedBytes = await watermarkImage(original.body, version.contentType, stampOptions, t)
    } else {
      stampedBytes = original.body
    }

    // Written next to the source version under a `watermarks/` sub-key so it
    // inherits the same tenant prefix and can be swept by the same retention
    // job; the short TTL below is what actually makes the URL "one-time" in
    // practice.
    const watermarkKey = buildKey({
      tenantId: db.tenantId,
      ownerType: document.ownerType as DocumentOwnerType,
      ownerId: document.ownerId,
      documentId: document.id,
      versionNumber: version.versionNumber,
      filename: `watermarks/${newId()}.pdf`,
    })
    assertKeyBelongsToTenant(watermarkKey, db.tenantId)
    await storage.put({ key: watermarkKey, body: Buffer.from(stampedBytes), contentType: 'application/pdf' })
    url = await storage.signedDownloadUrl(watermarkKey, { expiresInSeconds: WATERMARKED_URL_TTL_SECONDS })
    watermarked = true
  } else {
    url = await storage.signedDownloadUrl(version.storageKey)
  }

  await db.insert(documentAccessLogs, {
    documentId: document.id,
    documentVersionId: version.id,
    userId: actor.userId,
    action: input.action ?? 'download',
    watermarked,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
  })

  return { url, watermarked, document, version }
}

/* ── Soft delete / restore ───────────────────────────────────────────────── */

export async function softDeleteDocument(
  db: TenantDb,
  actor: Actor,
  documentId: string,
  reason?: string,
): Promise<Document> {
  await db.requireById(documents, documentId, 'document')
  const updated = await db.softDelete(documents, documentId, actor.userId, reason)
  if (!updated) throw notFound('document.errors.documentNotFound')
  return updated
}

export async function restoreDocument(db: TenantDb, documentId: string): Promise<Document> {
  const restored = await db.restore(documents, documentId)
  if (!restored) throw notFound('document.errors.documentNotFound')
  return restored
}

/* ── Expiration sweep ────────────────────────────────────────────────────── */

/** Documents whose expiration falls within `withinDays` (already expired or about to be). Used by the sweep job. */
export async function listExpiring(db: TenantDb, withinDays: number): Promise<Document[]> {
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() + withinDays)
  return db.findMany(documents, {
    where: and(isNotNull(documents.expirationDate), lte(documents.expirationDate, cutoff))!,
    orderBy: asc(documents.expirationDate),
  })
}

export interface MarkExpirationsResult {
  warnings: number
  expired: number
}

/**
 * Idempotently materializes `documentExpirations` rows for every document
 * inside the warning window. The unique index on (documentId, kind,
 * expirationDate) is the real guard against double-notifying; this function
 * additionally checks first so a re-run is a cheap no-op rather than a
 * constraint-violation retry loop.
 */
export async function markExpirations(db: TenantDb, withinDays: number): Promise<MarkExpirationsResult> {
  const now = new Date()
  const candidates = await listExpiring(db, withinDays)
  let warnings = 0
  let expired = 0

  for (const document of candidates) {
    if (!document.expirationDate) continue
    const kind: 'warning' | 'expired' = document.expirationDate.getTime() <= now.getTime() ? 'expired' : 'warning'

    const alreadyRecorded = await db.exists(
      documentExpirations,
      and(
        eq(documentExpirations.documentId, document.id),
        eq(documentExpirations.kind, kind),
        eq(documentExpirations.expirationDate, document.expirationDate),
      )!,
    )
    if (alreadyRecorded) continue

    await db.insert(documentExpirations, {
      documentId: document.id,
      expirationDate: document.expirationDate,
      warningDays: withinDays,
      kind,
    })
    if (kind === 'warning') warnings += 1
    else expired += 1
  }

  return { warnings, expired }
}

/** Unresolved expirations still needing attention — surfaced on compliance dashboards. */
export async function listUnresolvedExpirations(db: TenantDb) {
  return db.findMany(documentExpirations, {
    where: isNull(documentExpirations.resolvedAt),
    orderBy: asc(documentExpirations.expirationDate),
  })
}
