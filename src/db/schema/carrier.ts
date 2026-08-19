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
  onboardingStatusEnum,
  primaryId,
  retention,
  timestamps,
  verificationStatusEnum,
} from './_shared'
import { tenants } from './tenant'
import { users } from './auth'

/* ── Carriers ────────────────────────────────────────────────────────────── */

/**
 * A carrier that works with two dispatch companies exists as two independent
 * rows — one per tenant. There is no global carrier registry by design.
 */
export const carriers = pgTable(
  'carriers',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legalName: varchar('legal_name', { length: 200 }).notNull(),
    dba: varchar('dba', { length: 200 }),
    dotNumber: varchar('dot_number', { length: 12 }).notNull(),
    mcNumber: varchar('mc_number', { length: 12 }),
    /** EIN is encrypted at rest; only the last four are ever rendered. */
    einEncrypted: text('ein_encrypted'),
    einLast4: varchar('ein_last4', { length: 4 }),

    contactFirstName: varchar('contact_first_name', { length: 100 }).notNull(),
    contactLastName: varchar('contact_last_name', { length: 100 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 32 }).notNull(),
    website: varchar('website', { length: 255 }),
    preferredLocale: localeEnum('preferred_locale').notNull().default('en'),

    physicalLine1: varchar('physical_line1', { length: 200 }),
    physicalLine2: varchar('physical_line2', { length: 200 }),
    physicalCity: varchar('physical_city', { length: 120 }),
    physicalState: varchar('physical_state', { length: 2 }),
    physicalPostalCode: varchar('physical_postal_code', { length: 12 }),
    physicalCountry: varchar('physical_country', { length: 2 }).default('US'),
    physicalPlaceId: varchar('physical_place_id', { length: 255 }),

    mailingSameAsPhysical: boolean('mailing_same_as_physical').notNull().default(true),
    mailingLine1: varchar('mailing_line1', { length: 200 }),
    mailingLine2: varchar('mailing_line2', { length: 200 }),
    mailingCity: varchar('mailing_city', { length: 120 }),
    mailingState: varchar('mailing_state', { length: 2 }),
    mailingPostalCode: varchar('mailing_postal_code', { length: 12 }),
    mailingCountry: varchar('mailing_country', { length: 2 }).default('US'),

    /** Percentage the dispatch company charges this carrier, in basis points. */
    dispatchFeeBps: integer('dispatch_fee_bps').notNull().default(1000),

    onboardingStatus: onboardingStatusEnum('onboarding_status').notNull().default('draft'),
    fmcsaStatus: verificationStatusEnum('fmcsa_status').notNull().default('not_started'),
    fmcsaLastVerifiedAt: timestamp('fmcsa_last_verified_at', { withTimezone: true }),
    fmcsaNextVerificationAt: timestamp('fmcsa_next_verification_at', { withTimezone: true }),

    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspensionReason: text('suspension_reason'),

    usesFactoring: boolean('uses_factoring').notNull().default(false),
    notes: text('notes'),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),

    ...auditable,
    ...retention,
  },
  (t) => [
    uniqueIndex('carriers_tenant_dot_uq').on(t.tenantId, t.dotNumber),
    index('carriers_tenant_idx').on(t.tenantId),
    index('carriers_tenant_status_idx').on(t.tenantId, t.onboardingStatus),
    index('carriers_tenant_mc_idx').on(t.tenantId, t.mcNumber),
    index('carriers_legal_name_idx').on(t.tenantId, t.legalName),
    index('carriers_next_verification_idx').on(t.fmcsaNextVerificationAt),
  ],
)

/* ── Carrier users ───────────────────────────────────────────────────────── */

export const carrierUsers = pgTable(
  'carrier_users',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    title: varchar('title', { length: 120 }),
    ...auditable,
  },
  (t) => [
    uniqueIndex('carrier_users_uq').on(t.tenantId, t.carrierId, t.userId),
    index('carrier_users_tenant_idx').on(t.tenantId),
    index('carrier_users_user_idx').on(t.userId),
  ],
)

/* ── Onboarding workflow ─────────────────────────────────────────────────── */

export const carrierOnboardings = pgTable(
  'carrier_onboardings',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id, { onDelete: 'cascade' }),
    status: onboardingStatusEnum('status').notNull().default('draft'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewStartedAt: timestamp('review_started_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    correctionsRequestedAt: timestamp('corrections_requested_at', { withTimezone: true }),
    correctionNotes: text('correction_notes'),
    rejectionReason: text('rejection_reason'),
    requiredDocumentTypes: jsonb('required_document_types').$type<string[]>().notNull().default([]),
    checklist: jsonb('checklist')
      .$type<Array<{ key: string; complete: boolean; blocking: boolean }>>()
      .notNull()
      .default([]),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('carrier_onboardings_tenant_idx').on(t.tenantId),
    index('carrier_onboardings_tenant_status_idx').on(t.tenantId, t.status),
    uniqueIndex('carrier_onboardings_carrier_uq').on(t.carrierId),
  ],
)

export const carrierOnboardingEvents = pgTable(
  'carrier_onboarding_events',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    onboardingId: uuid('onboarding_id')
      .notNull()
      .references(() => carrierOnboardings.id, { onDelete: 'cascade' }),
    fromStatus: onboardingStatusEnum('from_status'),
    toStatus: onboardingStatusEnum('to_status').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    reason: text('reason'),
    ...timestamps,
  },
  (t) => [index('carrier_onboarding_events_onboarding_idx').on(t.onboardingId)],
)

/* ── Dispatcher profiles, assignments, groups ────────────────────────────── */

export const dispatcherProfiles = pgTable(
  'dispatcher_profiles',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Commission percentage in basis points (2500 = 25.00%). */
    commissionBps: integer('commission_bps').notNull().default(2500),
    employeeCode: varchar('employee_code', { length: 40 }),
    hiredOn: timestamp('hired_on', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
    ...auditable,
  },
  (t) => [
    uniqueIndex('dispatcher_profiles_tenant_user_uq').on(t.tenantId, t.userId),
    index('dispatcher_profiles_tenant_idx').on(t.tenantId),
  ],
)

export const carrierDispatcherAssignments = pgTable(
  'carrier_dispatcher_assignments',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id, { onDelete: 'cascade' }),
    dispatcherUserId: uuid('dispatcher_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    startDate: timestamp('start_date', { withTimezone: true }).notNull().defaultNow(),
    endDate: timestamp('end_date', { withTimezone: true }),
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id),
    reason: text('reason'),
    ...auditable,
  },
  (t) => [
    index('carrier_dispatcher_tenant_idx').on(t.tenantId),
    index('carrier_dispatcher_carrier_idx').on(t.carrierId),
    index('carrier_dispatcher_user_idx').on(t.dispatcherUserId),
    index('carrier_dispatcher_active_idx').on(t.tenantId, t.dispatcherUserId, t.endDate),
  ],
)

export const dispatcherGroups = pgTable(
  'dispatcher_groups',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    ownerDispatcherUserId: uuid('owner_dispatcher_user_id').references(() => users.id),
    active: boolean('active').notNull().default(true),
    ...auditable,
  },
  (t) => [
    uniqueIndex('dispatcher_groups_tenant_name_uq').on(t.tenantId, t.name),
    index('dispatcher_groups_tenant_idx').on(t.tenantId),
  ],
)

/** A group can hold carriers, trucks, trailers and drivers — one row per member. */
export const groupMembers = pgTable(
  'group_members',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => dispatcherGroups.id, { onDelete: 'cascade' }),
    memberType: varchar('member_type', { length: 20 }).notNull(), // carrier|truck|trailer|driver
    memberId: uuid('member_id').notNull(),
    addedByUserId: uuid('added_by_user_id').references(() => users.id),
    ...auditable,
  },
  (t) => [
    uniqueIndex('group_members_uq').on(t.groupId, t.memberType, t.memberId),
    index('group_members_tenant_idx').on(t.tenantId),
    index('group_members_lookup_idx').on(t.tenantId, t.memberType, t.memberId),
  ],
)

/**
 * Explicit resource-level grants for dispatchers. A dispatcher assigned to a
 * carrier may still only edit the trucks/trailers/drivers granted here (or the
 * ones reachable through a group they own).
 */
export const dispatcherResourceAssignments = pgTable(
  'dispatcher_resource_assignments',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dispatcherUserId: uuid('dispatcher_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resourceType: varchar('resource_type', { length: 20 }).notNull(), // truck|trailer|driver|group
    resourceId: uuid('resource_id').notNull(),
    startDate: timestamp('start_date', { withTimezone: true }).notNull().defaultNow(),
    endDate: timestamp('end_date', { withTimezone: true }),
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id),
    reason: text('reason'),
    ...auditable,
  },
  (t) => [
    index('dispatcher_resource_tenant_idx').on(t.tenantId),
    index('dispatcher_resource_user_idx').on(t.tenantId, t.dispatcherUserId),
    uniqueIndex('dispatcher_resource_uq').on(
      t.tenantId,
      t.dispatcherUserId,
      t.resourceType,
      t.resourceId,
      t.startDate,
    ),
  ],
)

/* ── FMCSA verification ledger ───────────────────────────────────────────── */

export const fmcsaVerifications = pgTable(
  'fmcsa_verifications',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 40 }).notNull().default('mock'),
    dotNumber: varchar('dot_number', { length: 12 }).notNull(),
    mcNumber: varchar('mc_number', { length: 12 }),
    status: verificationStatusEnum('status').notNull(),
    /** Normalized, provider-independent projection used by the application. */
    normalized: jsonb('normalized').$type<{
      legalName?: string
      dbaName?: string
      dotStatus?: string
      allowedToOperate?: boolean
      operatingAuthority?: string
      safetyRating?: string | null
      insuranceOnFile?: boolean
      insuranceRequiredCents?: number | null
      powerUnits?: number | null
      drivers?: number | null
      addressState?: string | null
      outOfServiceDate?: string | null
    }>(),
    /** Field-by-field comparison against the tenant-entered data. */
    mismatches: jsonb('mismatches')
      .$type<Array<{ field: string; entered: string | null; reported: string | null }>>()
      .notNull()
      .default([]),
    rawReference: text('raw_reference'),
    rawPayloadDigest: varchar('raw_payload_digest', { length: 64 }),
    attempt: integer('attempt').notNull().default(1),
    errorMessage: text('error_message'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    overriddenByUserId: uuid('overridden_by_user_id').references(() => users.id),
    overrideReason: text('override_reason'),
    overriddenAt: timestamp('overridden_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('fmcsa_verifications_tenant_idx').on(t.tenantId),
    index('fmcsa_verifications_carrier_idx').on(t.carrierId, t.checkedAt),
    index('fmcsa_verifications_dot_idx').on(t.dotNumber),
  ],
)

/* ── Factoring ───────────────────────────────────────────────────────────── */

export const factoringCompanies = pgTable(
  'factoring_companies',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    contactName: varchar('contact_name', { length: 200 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 32 }),
    addressLine1: varchar('address_line1', { length: 200 }),
    addressCity: varchar('address_city', { length: 120 }),
    addressState: varchar('address_state', { length: 2 }),
    addressPostalCode: varchar('address_postal_code', { length: 12 }),
    fundingInstructions: text('funding_instructions'),
    active: boolean('active').notNull().default(true),
    ...auditable,
  },
  (t) => [
    uniqueIndex('factoring_companies_tenant_name_uq').on(t.tenantId, t.name),
    index('factoring_companies_tenant_idx').on(t.tenantId),
  ],
)

export const factoringAssignments = pgTable(
  'factoring_assignments',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id, { onDelete: 'cascade' }),
    factoringCompanyId: uuid('factoring_company_id')
      .notNull()
      .references(() => factoringCompanies.id),
    /** Manual workflow: nothing here is settled through a factoring API. */
    verificationStatus: verificationStatusEnum('verification_status')
      .notNull()
      .default('not_started'),
    noticeOfAssignmentDocumentId: uuid('notice_of_assignment_document_id'),
    changeOfPayeeDocumentId: uuid('change_of_payee_document_id'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    notes: text('notes'),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('factoring_assignments_tenant_idx').on(t.tenantId),
    index('factoring_assignments_carrier_idx').on(t.carrierId),
  ],
)

/* ── Relations ───────────────────────────────────────────────────────────── */

export const carriersRelations = relations(carriers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [carriers.tenantId], references: [tenants.id] }),
  onboarding: one(carrierOnboardings, {
    fields: [carriers.id],
    references: [carrierOnboardings.carrierId],
  }),
  carrierUsers: many(carrierUsers),
  dispatcherAssignments: many(carrierDispatcherAssignments),
  fmcsaVerifications: many(fmcsaVerifications),
}))

export type Carrier = typeof carriers.$inferSelect
export type NewCarrier = typeof carriers.$inferInsert
export type CarrierOnboarding = typeof carrierOnboardings.$inferSelect
export type DispatcherProfile = typeof dispatcherProfiles.$inferSelect
export type CarrierDispatcherAssignment = typeof carrierDispatcherAssignments.$inferSelect
export type DispatcherGroup = typeof dispatcherGroups.$inferSelect
export type GroupMember = typeof groupMembers.$inferSelect
export type FmcsaVerification = typeof fmcsaVerifications.$inferSelect
export type FactoringCompany = typeof factoringCompanies.$inferSelect
export type FactoringAssignment = typeof factoringAssignments.$inferSelect
