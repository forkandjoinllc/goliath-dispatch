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
  auditActionEnum,
  auditable,
  jobStatusEnum,
  localeEnum,
  primaryId,
  retention,
  timestamps,
} from './_shared'
import { tenants } from './tenant'
import { users } from './auth'

/* ── Marketing capture ───────────────────────────────────────────────────── */

export const leads = pgTable(
  'leads',
  {
    id: primaryId(),
    /** Null for platform-level leads captured on the SaaS marketing site. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    companyName: varchar('company_name', { length: 200 }),
    dotNumber: varchar('dot_number', { length: 12 }),
    mcNumber: varchar('mc_number', { length: 12 }),
    message: text('message'),
    locale: localeEnum('locale').notNull().default('en'),
    /** contact_form | carrier_signup | quote_request | resources */
    source: varchar('source', { length: 40 }).notNull().default('contact_form'),
    sourcePath: varchar('source_path', { length: 255 }),
    utm: jsonb('utm').$type<Record<string, string>>(),
    /** new | contacted | qualified | converted | disqualified */
    status: varchar('status', { length: 20 }).notNull().default('new'),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('leads_tenant_idx').on(t.tenantId),
    index('leads_status_idx').on(t.tenantId, t.status),
    index('leads_created_idx').on(t.createdAt),
    index('leads_email_idx').on(t.email),
  ],
)

export const quoteRequests = pgTable(
  'quote_requests',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    contactName: varchar('contact_name', { length: 200 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    companyName: varchar('company_name', { length: 200 }),
    commodity: varchar('commodity', { length: 200 }),
    weightPounds: integer('weight_pounds'),
    lengthInches: integer('length_inches'),
    widthInches: integer('width_inches'),
    heightInches: integer('height_inches'),
    originCity: varchar('origin_city', { length: 120 }),
    originState: varchar('origin_state', { length: 2 }),
    destinationCity: varchar('destination_city', { length: 120 }),
    destinationState: varchar('destination_state', { length: 2 }),
    readyDate: timestamp('ready_date', { withTimezone: true }),
    equipmentPreference: varchar('equipment_preference', { length: 80 }),
    isOversizeSuspected: boolean('is_oversize_suspected').notNull().default(false),
    notes: text('notes'),
    locale: localeEnum('locale').notNull().default('en'),
    status: varchar('status', { length: 20 }).notNull().default('new'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('quote_requests_tenant_idx').on(t.tenantId),
    index('quote_requests_status_idx').on(t.tenantId, t.status),
    index('quote_requests_created_idx').on(t.createdAt),
  ],
)

/* ── Audit ───────────────────────────────────────────────────────────────── */

/**
 * Append-only. The application never issues UPDATE or DELETE against this table;
 * a database trigger (see drizzle/custom/0001_audit_immutability.sql) enforces it.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    /** The account that authenticated. */
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorEmail: varchar('actor_email', { length: 255 }),
    actorRole: varchar('actor_role', { length: 40 }),
    /** During impersonation: whose authority the action ran under. */
    effectiveUserId: uuid('effective_user_id').references(() => users.id),
    impersonationSessionId: uuid('impersonation_session_id'),
    action: auditActionEnum('action').notNull(),
    entityType: varchar('entity_type', { length: 60 }),
    entityId: uuid('entity_id'),
    entityLabel: varchar('entity_label', { length: 200 }),
    /** Redacted field-level diff; sensitive values are never stored here. */
    beforeSummary: jsonb('before_summary').$type<Record<string, unknown>>(),
    afterSummary: jsonb('after_summary').$type<Record<string, unknown>>(),
    /** Required for overrides, impersonation, deletions and legal holds. */
    reason: text('reason'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    requestId: varchar('request_id', { length: 64 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('audit_events_tenant_idx').on(t.tenantId, t.occurredAt),
    index('audit_events_actor_idx').on(t.actorUserId, t.occurredAt),
    index('audit_events_action_idx').on(t.tenantId, t.action, t.occurredAt),
    index('audit_events_entity_idx').on(t.tenantId, t.entityType, t.entityId),
    index('audit_events_request_idx').on(t.requestId),
  ],
)

/* ── Exports ─────────────────────────────────────────────────────────────── */

export const exportJobs = pgTable(
  'export_jobs',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    reportKey: varchar('report_key', { length: 60 }).notNull(),
    format: varchar('format', { length: 10 }).notNull(), // csv | xlsx | pdf
    /** Filters are stored so the export can be reproduced and audited. */
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
    /** Permission scope applied at generation time; exports never widen access. */
    scopeSnapshot: jsonb('scope_snapshot').$type<Record<string, unknown>>(),
    status: jobStatusEnum('status').notNull().default('queued'),
    rowCount: integer('row_count'),
    storageKey: text('storage_key'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('export_jobs_tenant_idx').on(t.tenantId),
    index('export_jobs_user_idx').on(t.tenantId, t.requestedByUserId),
    index('export_jobs_status_idx').on(t.status),
  ],
)

/* ── Retention & legal hold ──────────────────────────────────────────────── */

export const legalHolds = pgTable(
  'legal_holds',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    reason: text('reason').notNull(),
    /** Scope: tenant-wide, an entity type, or a specific record. */
    scopeType: varchar('scope_type', { length: 20 }).notNull().default('tenant'),
    entityType: varchar('entity_type', { length: 60 }),
    entityId: uuid('entity_id'),
    matterReference: varchar('matter_reference', { length: 120 }),
    appliedByUserId: uuid('applied_by_user_id')
      .notNull()
      .references(() => users.id),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    releasedByUserId: uuid('released_by_user_id').references(() => users.id),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releaseReason: text('release_reason'),
    ...timestamps,
  },
  (t) => [
    index('legal_holds_tenant_idx').on(t.tenantId),
    index('legal_holds_active_idx').on(t.tenantId, t.releasedAt),
    index('legal_holds_entity_idx').on(t.tenantId, t.entityType, t.entityId),
  ],
)

export const retentionJobs = pgTable(
  'retention_jobs',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** archive | purge | anonymize */
    action: varchar('action', { length: 20 }).notNull(),
    entityType: varchar('entity_type', { length: 60 }).notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    cutoffAt: timestamp('cutoff_at', { withTimezone: true }).notNull(),
    candidateCount: integer('candidate_count').notNull().default(0),
    processedCount: integer('processed_count').notNull().default(0),
    skippedLegalHoldCount: integer('skipped_legal_hold_count').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('retention_jobs_tenant_idx').on(t.tenantId),
    index('retention_jobs_status_idx').on(t.status, t.createdAt),
  ],
)

/* ── Durable job queue ───────────────────────────────────────────────────── */

/**
 * Vercel-compatible: cron routes drain this queue. Every handler is idempotent
 * and tenant-aware; `dedupeKey` makes double-enqueue harmless.
 */
export const jobQueue = pgTable(
  'job_queue',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    jobType: varchar('job_type', { length: 60 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatusEnum('status').notNull().default('queued'),
    priority: integer('priority').notNull().default(100),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastError: text('last_error'),
    /** Set on the row while a worker owns it; expired leases are reclaimed. */
    lockedBy: varchar('locked_by', { length: 80 }),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    dedupeKey: varchar('dedupe_key', { length: 200 }),
    ...timestamps,
  },
  (t) => [
    index('job_queue_status_runat_idx').on(t.status, t.runAt),
    index('job_queue_type_idx').on(t.jobType, t.status),
    index('job_queue_tenant_idx').on(t.tenantId),
    uniqueIndex('job_queue_dedupe_uq').on(t.dedupeKey),
  ],
)

/** Idempotency ledger for inbound webhooks and mutating API routes. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 60 }).notNull(),
    key: varchar('key', { length: 200 }).notNull(),
    requestDigest: varchar('request_digest', { length: 64 }),
    responseSnapshot: jsonb('response_snapshot').$type<Record<string, unknown>>(),
    status: varchar('status', { length: 20 }).notNull().default('in_progress'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('idempotency_keys_scope_key_uq').on(t.scope, t.key),
    index('idempotency_keys_expiry_idx').on(t.expiresAt),
  ],
)

export type Lead = typeof leads.$inferSelect
export type QuoteRequest = typeof quoteRequests.$inferSelect
export type AuditEvent = typeof auditEvents.$inferSelect
export type NewAuditEvent = typeof auditEvents.$inferInsert
export type ExportJob = typeof exportJobs.$inferSelect
export type LegalHold = typeof legalHolds.$inferSelect
export type RetentionJob = typeof retentionJobs.$inferSelect
export type QueuedJob = typeof jobQueue.$inferSelect
