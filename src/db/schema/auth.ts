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
  consentTypeEnum,
  localeEnum,
  primaryId,
  roleEnum,
  timestamps,
  userStatusEnum,
} from './_shared'
import { tenants } from './tenant'

/* ── Users ───────────────────────────────────────────────────────────────── */

/**
 * A user is global (one login, one email) and gains capabilities exclusively
 * through UserTenantMembership rows. There is no tenant-level column here on
 * purpose: cross-tenant identity is expressed by memberships, never by copies.
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: varchar('email', { length: 255 }).notNull(),
    emailNormalized: varchar('email_normalized', { length: 255 }).notNull(),
    passwordHash: text('password_hash'),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    locale: localeEnum('locale').notNull().default('en'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('America/New_York'),
    avatarStorageKey: text('avatar_storage_key'),
    status: userStatusEnum('status').notNull().default('pending_verification'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    isPlatformSuperAdmin: boolean('is_platform_super_admin').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: varchar('last_login_ip', { length: 45 }),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    ...auditable,
  },
  (t) => [
    uniqueIndex('users_email_normalized_uq').on(t.emailNormalized),
    index('users_status_idx').on(t.status),
    index('users_platform_admin_idx').on(t.isPlatformSuperAdmin),
  ],
)

/* ── Memberships ─────────────────────────────────────────────────────────── */

export const userTenantMemberships = pgTable(
  'user_tenant_memberships',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    status: userStatusEnum('status').notNull().default('active'),
    /** Set for role='carrier' / 'driver' — links the membership to its carrier org. */
    carrierId: uuid('carrier_id'),
    /** Set for role='driver' — links the membership to the driver record. */
    driverId: uuid('driver_id'),
    isPrimaryContact: boolean('is_primary_contact').notNull().default(false),
    invitedByUserId: uuid('invited_by_user_id'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    ...auditable,
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_role_uq').on(t.tenantId, t.userId, t.role),
    index('memberships_tenant_idx').on(t.tenantId),
    index('memberships_user_idx').on(t.userId),
    index('memberships_tenant_role_idx').on(t.tenantId, t.role),
    index('memberships_carrier_idx').on(t.carrierId),
  ],
)

/* ── Roles & permissions (data-driven, not string checks in components) ──── */

export const permissions = pgTable(
  'permissions',
  {
    id: primaryId(),
    /** Canonical `resource:action` key, e.g. `load:assign_resources`. */
    key: varchar('key', { length: 120 }).notNull(),
    resource: varchar('resource', { length: 60 }).notNull(),
    action: varchar('action', { length: 60 }).notNull(),
    descriptionEn: text('description_en').notNull(),
    descriptionEs: text('description_es').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('permissions_key_uq').on(t.key), index('permissions_resource_idx').on(t.resource)],
)

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: primaryId(),
    role: roleEnum('role').notNull(),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    /** Assignment scope the grant is limited to. */
    scope: varchar('scope', { length: 20 }).notNull().default('tenant'), // platform|tenant|assigned|own
    ...timestamps,
  },
  (t) => [uniqueIndex('role_permissions_uq').on(t.role, t.permissionId)],
)

export const userPermissionOverrides = pgTable(
  'user_permission_overrides',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    effect: varchar('effect', { length: 8 }).notNull(), // grant | deny
    scope: varchar('scope', { length: 20 }).notNull().default('tenant'),
    reason: text('reason').notNull(),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...auditable,
  },
  (t) => [
    uniqueIndex('user_permission_overrides_uq').on(t.tenantId, t.userId, t.permissionId),
    index('user_permission_overrides_tenant_user_idx').on(t.tenantId, t.userId),
  ],
)

/* ── Sessions, MFA, tokens ───────────────────────────────────────────────── */

export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the opaque session token. The raw token never touches the DB. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    activeTenantId: uuid('active_tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    mfaSatisfiedAt: timestamp('mfa_satisfied_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: varchar('revoked_reason', { length: 120 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
)

export const mfaConfigurations = pgTable(
  'mfa_configurations',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    method: varchar('method', { length: 20 }).notNull().default('totp'),
    /** Encrypted TOTP secret — never stored in the clear. */
    secretEncrypted: text('secret_encrypted').notNull(),
    /** Hashed single-use recovery codes. */
    recoveryCodeHashes: jsonb('recovery_code_hashes').$type<string[]>().notNull().default([]),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    ...auditable,
  },
  (t) => [uniqueIndex('mfa_configurations_user_method_uq').on(t.userId, t.method)],
)

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', { length: 40 }).notNull(), // email_verification|password_reset|invitation
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    email: varchar('email', { length: 255 }),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('verification_tokens_hash_uq').on(t.tokenHash),
    index('verification_tokens_user_purpose_idx').on(t.userId, t.purpose),
    index('verification_tokens_expires_idx').on(t.expiresAt),
  ],
)

/* ── Consent ─────────────────────────────────────────────────────────────── */

export const consentRecords = pgTable(
  'consent_records',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Present when consent is captured before a user account exists (public signup). */
    subjectEmail: varchar('subject_email', { length: 255 }),
    consentType: consentTypeEnum('consent_type').notNull(),
    policyVersion: varchar('policy_version', { length: 40 }).notNull(),
    granted: boolean('granted').notNull().default(true),
    locale: localeEnum('locale').notNull().default('en'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('consent_records_user_type_idx').on(t.userId, t.consentType),
    index('consent_records_tenant_idx').on(t.tenantId),
  ],
)

/* ── Impersonation ───────────────────────────────────────────────────────── */

export const impersonationSessions = pgTable(
  'impersonation_sessions',
  {
    id: primaryId(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    targetUserId: uuid('target_user_id')
      .notNull()
      .references(() => users.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    index('impersonation_actor_idx').on(t.actorUserId),
    index('impersonation_target_idx').on(t.targetUserId),
    index('impersonation_tenant_idx').on(t.tenantId),
  ],
)

/* ── Login attempt ledger (brute-force protection + audit) ───────────────── */

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: primaryId(),
    emailNormalized: varchar('email_normalized', { length: 255 }).notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    successful: boolean('successful').notNull(),
    failureReason: varchar('failure_reason', { length: 60 }),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [
    index('login_attempts_email_created_idx').on(t.emailNormalized, t.createdAt),
    index('login_attempts_ip_created_idx').on(t.ipAddress, t.createdAt),
  ],
)

/* ── Rate limiting (durable driver) ──────────────────────────────────────── */

export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    id: primaryId(),
    bucketKey: varchar('bucket_key', { length: 255 }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('rate_limit_buckets_key_window_uq').on(t.bucketKey, t.windowStart)],
)

/* ── Relations ───────────────────────────────────────────────────────────── */

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(userTenantMemberships),
  sessions: many(sessions),
  mfa: many(mfaConfigurations),
  consents: many(consentRecords),
}))

export const membershipsRelations = relations(userTenantMemberships, ({ one }) => ({
  user: one(users, { fields: [userTenantMemberships.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [userTenantMemberships.tenantId], references: [tenants.id] }),
}))

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}))

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type UserTenantMembership = typeof userTenantMemberships.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Permission = typeof permissions.$inferSelect
export type ConsentRecord = typeof consentRecords.$inferSelect
export type ImpersonationSession = typeof impersonationSessions.$inferSelect
