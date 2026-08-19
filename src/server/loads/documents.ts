import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { documents, loadDocuments, loadStops, loads, type Document, type DocumentVersion } from '@/db/schema'
import { notFound } from '@/lib/errors'
import type { Actor } from '@/lib/permissions'
import {
  softDeleteDocument as softDeleteDocumentService,
  uploadDocument as uploadDocumentService,
} from '@/server/documents/service'

/**
 * Load documents.
 *
 * `documents/service.ts` owns validation, malware scanning, sha256,
 * versioning, storage keys and retention for every document in the system —
 * that does not change here. What this module owns is the one thing nothing
 * else in the codebase did: creating the `load_documents` join row that
 * `hasApprovedPod()` (`status-machine.ts`'s `pod_received` gate) and
 * `recordRateConfirmationDecision()` (`service.ts`) both read. Without a row
 * here, a document uploaded against `ownerType: 'load'` is invisible to both
 * — which is exactly the gap this file closes.
 *
 * `uploadLoadDocument` wraps the document-service upload and the join insert
 * in one transaction so a document can never exist without its load link, or
 * vice versa.
 */

type LoadDocumentRow = typeof loadDocuments.$inferSelect
type LoadDocumentType = (typeof documents.documentType.enumValues)[number]

export interface UploadLoadDocumentInput {
  loadId: string
  documentType: LoadDocumentType
  /** Optional: ties the document to one stop (e.g. a POD signed at a specific delivery). */
  stopId?: string | null
  originalFilename: string
  bytes: Buffer
}

export interface UploadLoadDocumentResult {
  document: Document
  version: DocumentVersion
  link: LoadDocumentRow
}

export async function uploadLoadDocument(
  db: TenantDb,
  actor: Actor,
  input: UploadLoadDocumentInput,
): Promise<UploadLoadDocumentResult> {
  const load = await db.requireById(loads, input.loadId, 'load')

  if (input.stopId) {
    const stop = await db.findById(loadStops, input.stopId)
    if (!stop || stop.loadId !== load.id) {
      throw notFound('errors.notFound', { entity: 'loadStop' })
    }
  }

  return db.transaction(async (tx) => {
    const uploaded = await uploadDocumentService(tx, actor, {
      ownerType: 'load',
      ownerId: load.id,
      documentType: input.documentType,
      originalFilename: input.originalFilename,
      bytes: input.bytes,
    })

    const link = await tx.insert(loadDocuments, {
      loadId: load.id,
      documentId: uploaded.document.id,
      documentType: input.documentType,
      stopId: input.stopId ?? null,
    })

    return { ...uploaded, link }
  })
}

export interface RemoveLoadDocumentInput {
  loadId: string
  documentId: string
  reason?: string | null
}

/**
 * Soft-deletes the join row and the underlying document together. Either one
 * left behind would be a half-removed document: still linked to the load but
 * gone from the documents list, or vice versa.
 */
export async function removeLoadDocument(
  db: TenantDb,
  actor: Actor,
  input: RemoveLoadDocumentInput,
): Promise<Document> {
  const link = await db.findFirst(loadDocuments, {
    where: and(eq(loadDocuments.loadId, input.loadId), eq(loadDocuments.documentId, input.documentId))!,
  })
  if (!link) throw notFound('errors.notFound', { entity: 'loadDocument' })

  return db.transaction(async (tx) => {
    const removedLink = await tx.softDelete(loadDocuments, link.id, actor.userId, input.reason ?? undefined)
    if (!removedLink) throw notFound('errors.notFound', { entity: 'loadDocument' })
    return softDeleteDocumentService(tx, actor, input.documentId, input.reason ?? undefined)
  })
}
