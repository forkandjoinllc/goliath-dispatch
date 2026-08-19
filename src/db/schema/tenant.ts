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
  cents,
  commissionBasisEnum,
  localeEnum,
  primaryId,
  subscriptionStatusEnum,
  tenantStatusEnum,
  timestamps,
} from './_shared'

/* ── Tenants ─────────────────────────────────────────────────────────────── */

export const tenants = pgTable(
  'tenants',
  {
    id: primaryId(),
    slug: varchar('slug', { length: 63 }).notNull(),
    legalName: varchar('legal_name', { length: 200 }).notNull(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    status: tenantStatusEnum('status').notNull().default('provisioning'),
    customDomain: varchar('custom_domain', { length: 255 }),
    customDomainVerifiedAt: timestamp('custom_domain_verified_at', { withTimezone: true }),
    defaultLocale: localeEnum('default_locale').notNull().default('en'),
    defaultTimezone: varchar('default_timezone', { length: 64 }).notNull().default('America/New_York'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspensionReason: text('suspension_reason'),
    provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
    ...auditable,
  },
  (t) => [
    uniqueIndex('tenants_slug_uq').on(t.slug),
    uniqueIndex('tenants_custom_domain_uq').on(t.customDomain),
    index('tenants_status_idx').on(t.status),
  ],
)

/* ── Branding ────────────────────────────────────────────────────────────── */

export const tenantBranding = pgTable(
  'tenant_branding',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    logoStorageKey: text('logo_storage_key'),
    logoDarkStorageKey: text('logo_dark_storage_key'),
    faviconStorageKey: text('favicon_storage_key'),
    primaryColor: varchar('primary_color', { length: 9 }).notNull().default('#062B5C'),
    accentColor: varchar('accent_color', { length: 9 }).notNull().default('#FF5A00'),
    neutralColor: varchar('neutral_color', { length: 9 }).notNull().default('#9B9B9B'),
    surfaceColor: varchar('surface_color', { length: 9 }).notNull().default('#FFFFFF'),
    inkColor: varchar('ink_color', { length: 9 }).notNull().default('#111827'),
    headingFont: varchar('heading_font', { length: 80 }).notNull().default('Roboto Condensed'),
    bodyFont: varchar('body_font', { length: 80 }).notNull().default('Inter'),
    emailHeaderHtml: text('email_header_html'),
    emailFooterHtml: text('email_footer_html'),
    ...timestamps,
  },
  (t) => [uniqueIndex('tenant_branding_tenant_uq').on(t.tenantId)],
)

/* ── Settings ────────────────────────────────────────────────────────────── */

export const tenantSettings = pgTable(
  'tenant_settings',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    // Public contact information (rendered on the marketing site)
    contactPhone: varchar('contact_phone', { length: 32 }),
    contactEmail: varchar('contact_email', { length: 255 }),
    supportEmail: varchar('support_email', { length: 255 }),
    addressLine1: varchar('address_line1', { length: 200 }),
    addressLine2: varchar('address_line2', { length: 200 }),
    addressCity: varchar('address_city', { length: 120 }),
    addressState: varchar('address_state', { length: 2 }),
    addressPostalCode: varchar('address_postal_code', { length: 12 }),
    addressCountry: varchar('address_country', { length: 2 }).default('US'),
    businessHours: jsonb('business_hours').$type<
      Array<{ day: number; open: string | null; close: string | null; closed: boolean }>
    >(),
    socialLinks: jsonb('social_links').$type<Record<string, string>>(),

    // Operational policy
    documentExpirationWarningDays: integer('document_expiration_warning_days')
      .notNull()
      .default(30),
    fmcsaReverificationDays: integer('fmcsa_reverification_days').notNull().default(7),
    /** Default OFF. When false only Admin may assign trucks/trailers/drivers to loads. */
    allowDispatcherResourceAssignment: boolean('allow_dispatcher_resource_assignment')
      .notNull()
      .default(false),
    requireOversizeAdminValidation: boolean('require_oversize_admin_validation')
      .notNull()
      .default(true),
    loadNumberPrefix: varchar('load_number_prefix', { length: 12 }).notNull().default('GD'),
    loadNumberNextSequence: integer('load_number_next_sequence').notNull().default(1000),
    invoiceNumberPrefix: varchar('invoice_number_prefix', { length: 12 }).notNull().default('INV'),
    invoiceNumberNextSequence: integer('invoice_number_next_sequence').notNull().default(1000),
    defaultPaymentTermsDays: integer('default_payment_terms_days').notNull().default(30),

    // Financial policy
    defaultCarrierDispatchFeeBps: integer('default_carrier_dispatch_fee_bps').notNull().default(1000),
    defaultDispatcherCommissionBps: integer('default_dispatcher_commission_bps')
      .notNull()
      .default(2500),
    dispatcherCommissionBasis: commissionBasisEnum('dispatcher_commission_basis')
      .notNull()
      .default('dispatch_fee_amount'),

    // Retention policy (months / years)
    operationalActiveMonths: integer('operational_active_months').notNull().default(24),
    operationalPurgeYearsAfterArchive: integer('operational_purge_years_after_archive')
      .notNull()
      .default(5),
    financialRetentionYears: integer('financial_retention_years').notNull().default(7),

    // Public tracking
    publicTrackingEnabled: boolean('public_tracking_enabled').notNull().default(true),
    publicTrackingTokenTtlHours: integer('public_tracking_token_ttl_hours').notNull().default(72),

    // Legal copy shown in the e-signature ceremony (tenant-editable, per locale)
    signatureConsentCopy: jsonb('signature_consent_copy').$type<Record<string, string>>(),

    ...timestamps,
  },
  (t) => [uniqueIndex('tenant_settings_tenant_uq').on(t.tenantId)],
)

/* ── SaaS plans & subscriptions ──────────────────────────────────────────── */

export const saasPlans = pgTable(
  'saas_plans',
  {
    id: primaryId(),
    code: varchar('code', { length: 40 }).notNull(),
    nameEn: varchar('name_en', { length: 120 }).notNull(),
    nameEs: varchar('name_es', { length: 120 }).notNull(),
    descriptionEn: text('description_en'),
    descriptionEs: text('description_es'),
    monthlyPriceCents: cents('monthly_price_cents').notNull(),
    stripePriceId: varchar('stripe_price_id', { length: 255 }),
    stripeProductId: varchar('stripe_product_id', { length: 255 }),
    trialDays: integer('trial_days').notNull().default(14),
    maxUsers: integer('max_users'),
    maxCarriers: integer('max_carriers'),
    maxLoadsPerMonth: integer('max_loads_per_month'),
    features: jsonb('features').$type<string[]>().notNull().default([]),
    isPublic: boolean('is_public').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...auditable,
  },
  (t) => [uniqueIndex('saas_plans_code_uq').on(t.code)],
)

export const tenantSubscriptions = pgTable(
  'tenant_subscriptions',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => saasPlans.id),
    status: subscriptionStatusEnum('status').notNull().default('trialing'),
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    pastDueSince: timestamp('past_due_since', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('tenant_subscriptions_tenant_idx').on(t.tenantId),
    uniqueIndex('tenant_subscriptions_stripe_sub_uq').on(t.stripeSubscriptionId),
    index('tenant_subscriptions_status_idx').on(t.status),
  ],
)

/* ── Configurable tenant taxonomies ──────────────────────────────────────── */

export const equipmentTypes = pgTable(
  'equipment_types',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 40 }).notNull(),
    labelEn: varchar('label_en', { length: 120 }).notNull(),
    labelEs: varchar('label_es', { length: 120 }).notNull(),
    category: varchar('category', { length: 20 }).notNull().default('trailer'), // trailer | truck
    isSystem: boolean('is_system').notNull().default(false),
    supportsRgn: boolean('supports_rgn').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...auditable,
  },
  (t) => [
    uniqueIndex('equipment_types_tenant_code_uq').on(t.tenantId, t.code),
    index('equipment_types_tenant_idx').on(t.tenantId),
  ],
)

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  branding: one(tenantBranding, { fields: [tenants.id], references: [tenantBranding.tenantId] }),
  settings: one(tenantSettings, { fields: [tenants.id], references: [tenantSettings.tenantId] }),
  subscriptions: many(tenantSubscriptions),
  equipmentTypes: many(equipmentTypes),
}))

export const tenantSubscriptionsRelations = relations(tenantSubscriptions, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantSubscriptions.tenantId], references: [tenants.id] }),
  plan: one(saasPlans, { fields: [tenantSubscriptions.planId], references: [saasPlans.id] }),
}))

export type Tenant = typeof tenants.$inferSelect
export type NewTenant = typeof tenants.$inferInsert
export type TenantSettings = typeof tenantSettings.$inferSelect
export type TenantBranding = typeof tenantBranding.$inferSelect
export type SaasPlan = typeof saasPlans.$inferSelect
export type TenantSubscription = typeof tenantSubscriptions.$inferSelect
export type EquipmentType = typeof equipmentTypes.$inferSelect
