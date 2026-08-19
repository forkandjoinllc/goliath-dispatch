import { relations } from 'drizzle-orm'
import {
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
  localeEnum,
  primaryId,
  retention,
  signatureMethodEnum,
  signatureStatusEnum,
  timestamps,
} from './_shared'
import { tenants } from './tenant'
import { users } from './auth'
import { carriers } from './carrier'
import { documents } from './document'

/* ── Templates ───────────────────────────────────────────────────────────── */

/**
 * Versioned agreement templates. Bumping `version` invalidates prior signatures
 * for compliance purposes and triggers a re-signature request.
 */
export const signatureTemplates = pgTable(
  'signature_templates',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** notice_of_assignment | change_of_payee | carrier_agreement | custom */
    templateKey: varchar('template_key', { length: 60 }).notNull(),
    version: integer('version').notNull().default(1),
    titleEn: varchar('title_en', { length: 200 }).notNull(),
    titleEs: varchar('title_es', { length: 200 }).notNull(),
    /** Markdown-ish body with {{token}} placeholders, one per locale. */
    bodyEn: text('body_en').notNull(),
    bodyEs: text('body_es').notNull(),
    /** Tenant-editable legal copy shown during the ceremony. */
    consentCopyEn: text('consent_copy_en').notNull(),
    consentCopyEs: text('consent_copy_es').notNull(),
    /** SHA-256 of the canonical template content — pinned into every signature. */
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    requiredTokens: jsonb('required_tokens').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    ...auditable,
    ...retention,
  },
  (t) => [
    uniqueIndex('signature_templates_tenant_key_version_uq').on(
      t.tenantId,
      t.templateKey,
      t.version,
    ),
    index('signature_templates_tenant_idx').on(t.tenantId),
    index('signature_templates_active_idx').on(t.tenantId, t.templateKey, t.active),
  ],
)

/* ── Requests ────────────────────────────────────────────────────────────── */

export const signatureRequests = pgTable(
  'signature_requests',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => signatureTemplates.id),
    templateVersion: integer('template_version').notNull(),
    templateContentHash: varchar('template_content_hash', { length: 64 }).notNull(),
    /** Polymorphic subject: carrier | load | tenant */
    subjectType: varchar('subject_type', { length: 20 }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    carrierId: uuid('carrier_id').references(() => carriers.id, { onDelete: 'cascade' }),
    signerUserId: uuid('signer_user_id').references(() => users.id),
    signerEmail: varchar('signer_email', { length: 255 }).notNull(),
    signerLegalName: varchar('signer_legal_name', { length: 200 }),
    locale: localeEnum('locale').notNull().default('en'),
    status: signatureStatusEnum('status').notNull().default('pending'),
    /** Resolved token values rendered into the document. */
    tokenValues: jsonb('token_values').$type<Record<string, string>>().notNull().default({}),
    /** SHA-256 of the access token; the raw token is emailed, never stored. */
    accessTokenHash: varchar('access_token_hash', { length: 64 }),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    declineReason: text('decline_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    /** Set when a newer template version supersedes this request. */
    supersededByRequestId: uuid('superseded_by_request_id'),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('signature_requests_tenant_idx').on(t.tenantId),
    index('signature_requests_subject_idx').on(t.tenantId, t.subjectType, t.subjectId),
    index('signature_requests_status_idx').on(t.tenantId, t.status),
    index('signature_requests_carrier_idx').on(t.carrierId),
    uniqueIndex('signature_requests_token_uq').on(t.accessTokenHash),
  ],
)

/* ── Records (the tamper-evident artifact) ───────────────────────────────── */

export const signatureRecords = pgTable(
  'signature_records',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => signatureRequests.id, { onDelete: 'cascade' }),

    signerUserId: uuid('signer_user_id').references(() => users.id),
    signerLegalName: varchar('signer_legal_name', { length: 200 }).notNull(),
    signerEmail: varchar('signer_email', { length: 255 }).notNull(),
    signerTitle: varchar('signer_title', { length: 120 }),

    method: signatureMethodEnum('method').notNull(),
    /** Data URL (drawn) or rendered typed mark; stored as a private object. */
    signatureStorageKey: text('signature_storage_key').notNull(),
    /** SHA-256 of the raw signature bytes. */
    signatureSha256: varchar('signature_sha256', { length: 64 }).notNull(),
    typedNameValue: varchar('typed_name_value', { length: 200 }),

    consentAccepted: boolean('consent_accepted').notNull(),
    consentCopyHash: varchar('consent_copy_hash', { length: 64 }).notNull(),

    /** SHA-256 of the flattened, signed PDF bytes. */
    documentSha256: varchar('document_sha256', { length: 64 }).notNull(),
    signedDocumentId: uuid('signed_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    auditCertificateDocumentId: uuid('audit_certificate_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),

    /**
     * HMAC over (templateHash, documentSha256, signatureSha256, signer identity,
     * timestamp) keyed by SIGNATURE_HASH_PEPPER. Any later edit breaks the seal.
     */
    integritySeal: varchar('integrity_seal', { length: 64 }).notNull(),
    sealAlgorithm: varchar('seal_algorithm', { length: 40 }).notNull().default('HMAC-SHA256'),

    ipAddress: varchar('ip_address', { length: 45 }).notNull(),
    userAgent: text('user_agent').notNull(),
    locale: localeEnum('locale').notNull().default('en'),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    ...retention,
  },
  (t) => [
    uniqueIndex('signature_records_request_uq').on(t.requestId),
    index('signature_records_tenant_idx').on(t.tenantId),
    index('signature_records_signed_at_idx').on(t.tenantId, t.signedAt),
  ],
)

/** Append-only ceremony log. Rows are never updated or deleted. */
export const signatureAuditEvents = pgTable(
  'signature_audit_events',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => signatureRequests.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id').references(() => signatureRecords.id, { onDelete: 'set null' }),
    /** requested | emailed | opened | viewed | consent_shown | consent_accepted |
     *  signature_captured | document_generated | sealed | emailed_copy | declined |
     *  voided | superseded | certificate_downloaded */
    eventType: varchar('event_type', { length: 40 }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorEmail: varchar('actor_email', { length: 255 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    /** Hash chain: sha256(previousHash || canonical(this event)). */
    previousEventHash: varchar('previous_event_hash', { length: 64 }),
    eventHash: varchar('event_hash', { length: 64 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    ...retention,
  },
  (t) => [
    index('signature_audit_events_tenant_idx').on(t.tenantId),
    index('signature_audit_events_request_idx').on(t.requestId, t.occurredAt),
    uniqueIndex('signature_audit_events_hash_uq').on(t.eventHash),
  ],
)

export const signatureRequestsRelations = relations(signatureRequests, ({ one, many }) => ({
  template: one(signatureTemplates, {
    fields: [signatureRequests.templateId],
    references: [signatureTemplates.id],
  }),
  record: one(signatureRecords, {
    fields: [signatureRequests.id],
    references: [signatureRecords.requestId],
  }),
  auditEvents: many(signatureAuditEvents),
}))

export type SignatureTemplate = typeof signatureTemplates.$inferSelect
export type SignatureRequest = typeof signatureRequests.$inferSelect
export type SignatureRecord = typeof signatureRecords.$inferSelect
export type SignatureAuditEvent = typeof signatureAuditEvents.$inferSelect
