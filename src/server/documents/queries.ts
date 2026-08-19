import 'server-only'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  documentReviews,
  documentVersions,
  documents,
  type Document,
  type DocumentReview,
  type DocumentVersion,
} from '@/db/schema'
import type { ResourceContext } from '@/lib/permissions'
import type { DocumentOwnerType } from '@/lib/storage'

/**
 * Read helpers.
 *
 * `resolveDocumentResourceContext` is the one every mutating action and the
 * download route calls before `authorize()` — it is the only place a
 * document id is turned into the carrier/truck/trailer/driver facts a scope
 * check needs, so a dispatcher's "assigned" grant is evaluated against the
 * document's *actual* owner, never a client-supplied one.
 */
export function ownerResourceFacts(ownerType: DocumentOwnerType, ownerId: string): ResourceContext {
  switch (ownerType) {
    case 'carrier':
      return { carrierId: ownerId }
    case 'truck':
      return { truckId: ownerId }
    case 'trailer':
      return { trailerId: ownerId }
    case 'driver':
      return { driverId: ownerId }
    default:
      return {}
  }
}

export async function resolveDocumentResourceContext(
  db: TenantDb,
  documentId: string,
): Promise<ResourceContext> {
  const document = await db.findById(documents, documentId)
  if (!document) return { tenantId: db.tenantId }
  return {
    tenantId: document.tenantId,
    ...ownerResourceFacts(document.ownerType as DocumentOwnerType, document.ownerId),
  }
}

export interface DocumentWithCurrentVersion extends Document {
  currentVersion: DocumentVersion | null
}

/** Documents for one polymorphic owner, current-version-joined, newest first. */
export async function listDocumentsForOwner(
  db: TenantDb,
  ownerType: DocumentOwnerType,
  ownerId: string,
): Promise<DocumentWithCurrentVersion[]> {
  const rows = await db.findMany(documents, {
    where: and(eq(documents.ownerType, ownerType), eq(documents.ownerId, ownerId))!,
    orderBy: desc(documents.createdAt),
  })
  return attachCurrentVersions(db, rows)
}

/** Documents awaiting review, oldest first — the queue an Admin/Accounting reviewer works from. */
export async function listPendingReview(db: TenantDb): Promise<DocumentWithCurrentVersion[]> {
  const rows = await db.findMany(documents, {
    where: eq(documents.reviewStatus, 'pending'),
    orderBy: asc(documents.createdAt),
  })
  return attachCurrentVersions(db, rows)
}

async function attachCurrentVersions(
  db: TenantDb,
  rows: Document[],
): Promise<DocumentWithCurrentVersion[]> {
  if (rows.length === 0) return []
  const versionIds = rows
    .map((row) => row.currentVersionId)
    .filter((id): id is string => Boolean(id))

  const versions =
    versionIds.length > 0
      ? await db.findMany(documentVersions, { where: inArray(documentVersions.id, versionIds) })
      : []
  const versionById = new Map(versions.map((version) => [version.id, version]))

  return rows.map((row) => ({
    ...row,
    currentVersion: row.currentVersionId ? (versionById.get(row.currentVersionId) ?? null) : null,
  }))
}

export interface DocumentDetail {
  document: Document
  versions: DocumentVersion[]
  reviews: DocumentReview[]
}

/** Full history for a document detail screen: every version and every review decision. */
export async function getDocumentDetail(db: TenantDb, documentId: string): Promise<DocumentDetail> {
  const document = await db.requireById(documents, documentId, 'document')
  const [versions, reviews] = await Promise.all([
    db.findMany(documentVersions, {
      where: eq(documentVersions.documentId, documentId),
      orderBy: desc(documentVersions.versionNumber),
    }),
    db.findMany(documentReviews, {
      where: eq(documentReviews.documentId, documentId),
      orderBy: desc(documentReviews.reviewedAt),
    }),
  ])
  return { document, versions, reviews }
}
