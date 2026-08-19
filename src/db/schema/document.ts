import { relations } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import {
  auditable,
  documentReviewStatusEnum,
  documentTypeEnum,
  primaryId,
  retention,
  timestamps,
} from './_shared'
import { tenants } from './tenant'
import { users } from './auth'

/* ── Documents ───────────────────────────────────────────────────────────── */

/**
 * One logical document (e.g. "this carrier's COI") with an ordered chain of
 * immutable versions. The `currentVersionId` pointer is what the UI renders;
 * superseded versions are retained for the audit trail.
 */
export const documents = pgTable(
  'documents',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentType: documentTypeEnum('document_type').notNull(),
    /** Polymorphic owner: carrier | truck | trailer | driver | load | tenant | invoice */
    ownerType: varchar('owner_type', { length: 20 }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    title: varchar('title', { length: 200 }),
    description: text('description'),
    currentVersionId: uuid('current_version_id'),
    reviewStatus: documentReviewStatusEnum('review_status').notNull().default('pending'),
    issueDate: timestamp('issue_date', { withTimezone: true }),
    expirationDate: timestamp('expiration_date', { withTimezone: true }),
    /** True when the type is required for the owner's compliance gate. */
    isRequired: boolean('is_required').notNull().default(false),
    /** Denormalized for fast expiration sweeps. */
    expiresSoonAt: timestamp('expires_soon_at', { withTimezone: true }),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('documents_tenant_idx').on(t.tenantId),
    index('documents_owner_idx').on(t.tenantId, t.ownerType, t.ownerId),
    index('documents_type_idx').on(t.tenantId, t.documentType),
    index('documents_review_status_idx').on(t.tenantId, t.reviewStatus),
    index('documents_expiration_idx').on(t.tenantId, t.expirationDate),
    index('documents_expires_soon_idx').on(t.expiresSoonAt),
  ],
)

export const documentVersions = pgTable(
  'document_versions',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    /** Private object key. Always prefixed `tenants/<tenantId>/…` — see storage layer. */
    storageKey: text('storage_key').notNull(),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 120 }).notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    pageCount: integer('page_count'),
    malwareScanStatus: varchar('malware_scan_status', { length: 20 })
      .notNull()
      .default('not_scanned'),
    malwareScanAt: timestamp('malware_scan_at', { withTimezone: true }),
    /** Structured output of OCR/extraction (e.g. VINs found on a COI). */
    extraction: jsonb('extraction').$type<Record<string, unknown>>(),
    extractionStatus: varchar('extraction_status', { length: 20 }).notNull().default('not_started'),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id),
    ...auditable,
    ...retention,
  },
  (t) => [
    uniqueIndex('document_versions_doc_version_uq').on(t.documentId, t.versionNumber),
    index('document_versions_tenant_idx').on(t.tenantId),
    index('document_versions_sha_idx').on(t.tenantId, t.sha256),
  ],
)

export const documentReviews = pgTable(
  'document_reviews',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    status: documentReviewStatusEnum('status').notNull(),
    reviewerUserId: uuid('reviewer_user_id')
      .notNull()
      .references(() => users.id),
    notes: text('notes'),
    /** Required by policy whenever status = 'rejected'. */
    rejectionReason: text('rejection_reason'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('document_reviews_tenant_idx').on(t.tenantId),
    index('document_reviews_document_idx').on(t.documentId, t.reviewedAt),
  ],
)

/** Materialized expiration notices so the sweep job stays idempotent. */
export const documentExpirations = pgTable(
  'document_expirations',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    expirationDate: timestamp('expiration_date', { withTimezone: true }).notNull(),
    warningDays: integer('warning_days').notNull(),
    /** `warning` when approaching, `expired` once past due. */
    kind: varchar('kind', { length: 12 }).notNull(),
    firstDetectedAt: timestamp('first_detected_at', { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('document_expirations_uq').on(t.documentId, t.kind, t.expirationDate),
    index('document_expirations_tenant_idx').on(t.tenantId),
    index('document_expirations_unresolved_idx').on(t.tenantId, t.resolvedAt),
  ],
)

/** Every read of a private object is recorded — required by the retention policy. */
export const documentAccessLogs = pgTable(
  'document_access_logs',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id').references(() => documentVersions.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id').references(() => users.id),
    action: varchar('action', { length: 20 }).notNull(), // view | download | print
    watermarked: boolean('watermarked').notNull().default(false),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [
    index('document_access_logs_tenant_idx').on(t.tenantId),
    index('document_access_logs_document_idx').on(t.documentId, t.createdAt),
  ],
)

export const documentsRelations = relations(documents, ({ many }) => ({
  versions: many(documentVersions),
  reviews: many(documentReviews),
}))

export const documentVersionsRelations = relations(documentVersions, ({ one }) => ({
  document: one(documents, {
    fields: [documentVersions.documentId],
    references: [documents.id],
  }),
}))

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
export type DocumentVersion = typeof documentVersions.$inferSelect
export type DocumentReview = typeof documentReviews.$inferSelect
export type DocumentExpiration = typeof documentExpirations.$inferSelect
