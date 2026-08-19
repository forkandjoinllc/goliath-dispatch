import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { auditable, cents, primaryId, retention } from './_shared'
import { tenants } from './tenant'
import { users } from './auth'

/**
 * Customers are companies. They do not receive user accounts in this release —
 * the columns and relations here are shaped so a future customer portal can be
 * added without a migration of operational data.
 */
export const customers = pgTable(
  'customers',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyName: varchar('company_name', { length: 200 }).notNull(),
    /** Lowercased, punctuation-stripped name used for duplicate detection. */
    companyNameNormalized: varchar('company_name_normalized', { length: 200 }).notNull(),
    dotNumber: varchar('dot_number', { length: 12 }),
    mcNumber: varchar('mc_number', { length: 12 }),
    website: varchar('website', { length: 255 }),
    phone: varchar('phone', { length: 32 }),
    phoneNormalized: varchar('phone_normalized', { length: 20 }),
    email: varchar('email', { length: 255 }),
    emailNormalized: varchar('email_normalized', { length: 255 }),

    physicalLine1: varchar('physical_line1', { length: 200 }),
    physicalLine2: varchar('physical_line2', { length: 200 }),
    physicalCity: varchar('physical_city', { length: 120 }),
    physicalState: varchar('physical_state', { length: 2 }),
    physicalPostalCode: varchar('physical_postal_code', { length: 12 }),
    physicalPlaceId: varchar('physical_place_id', { length: 255 }),

    billingSameAsPhysical: boolean('billing_same_as_physical').notNull().default(true),
    billingLine1: varchar('billing_line1', { length: 200 }),
    billingLine2: varchar('billing_line2', { length: 200 }),
    billingCity: varchar('billing_city', { length: 120 }),
    billingState: varchar('billing_state', { length: 2 }),
    billingPostalCode: varchar('billing_postal_code', { length: 12 }),

    /** Tax ID is encrypted at rest; only the last four are displayed. */
    taxIdEncrypted: text('tax_id_encrypted'),
    taxIdLast4: varchar('tax_id_last4', { length: 4 }),

    creditLimitCents: cents('credit_limit_cents'),
    creditApproved: boolean('credit_approved').notNull().default(false),
    creditNotes: text('credit_notes'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),

    usesFactoring: boolean('uses_factoring').notNull().default(false),
    factoringCompanyName: varchar('factoring_company_name', { length: 200 }),

    status: varchar('status', { length: 20 }).notNull().default('active'), // active|on_hold|inactive
    notes: text('notes'),

    /** Recorded when a user proceeded past a duplicate warning. */
    duplicateOverrideByUserId: uuid('duplicate_override_by_user_id').references(() => users.id),
    duplicateOverrideReason: text('duplicate_override_reason'),

    ...auditable,
    ...retention,
  },
  (t) => [
    index('customers_tenant_idx').on(t.tenantId),
    index('customers_tenant_name_idx').on(t.tenantId, t.companyNameNormalized),
    index('customers_tenant_dot_idx').on(t.tenantId, t.dotNumber),
    index('customers_tenant_mc_idx').on(t.tenantId, t.mcNumber),
    index('customers_tenant_phone_idx').on(t.tenantId, t.phoneNormalized),
    index('customers_tenant_email_idx').on(t.tenantId, t.emailNormalized),
    index('customers_tenant_status_idx').on(t.tenantId, t.status),
  ],
)

export const customerLocations = pgTable(
  'customer_locations',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    line1: varchar('line1', { length: 200 }),
    line2: varchar('line2', { length: 200 }),
    city: varchar('city', { length: 120 }),
    state: varchar('state', { length: 2 }),
    postalCode: varchar('postal_code', { length: 12 }),
    country: varchar('country', { length: 2 }).default('US'),
    latitude: text('latitude'),
    longitude: text('longitude'),
    placeId: varchar('place_id', { length: 255 }),
    timezone: varchar('timezone', { length: 64 }),
    phone: varchar('phone', { length: 32 }),
    hours: varchar('hours', { length: 200 }),
    instructions: text('instructions'),
    isPrimary: boolean('is_primary').notNull().default(false),
    ...auditable,
  },
  (t) => [
    index('customer_locations_tenant_idx').on(t.tenantId),
    index('customer_locations_customer_idx').on(t.customerId),
  ],
)

export const customerContacts = pgTable(
  'customer_contacts',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 32 }),
    phoneExtension: varchar('phone_extension', { length: 10 }),
    position: varchar('position', { length: 120 }),
    /** Exactly one primary contact per customer is enforced by the service layer. */
    isPrimary: boolean('is_primary').notNull().default(false),
    notes: text('notes'),
    ...auditable,
  },
  (t) => [
    index('customer_contacts_tenant_idx').on(t.tenantId),
    index('customer_contacts_customer_idx').on(t.customerId),
    // At most one primary contact per customer, ignoring soft-deleted rows.
    uniqueIndex('customer_contacts_primary_uq')
      .on(t.customerId)
      .where(sql`is_primary = true and deleted_at is null`),
  ],
)

export const customerContactLocations = pgTable(
  'customer_contact_locations',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => customerContacts.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => customerLocations.id, { onDelete: 'cascade' }),
    ...auditable,
  },
  (t) => [
    uniqueIndex('customer_contact_locations_uq').on(t.contactId, t.locationId),
    index('customer_contact_locations_tenant_idx').on(t.tenantId),
  ],
)

export const customersRelations = relations(customers, ({ many }) => ({
  contacts: many(customerContacts),
  locations: many(customerLocations),
}))

export const customerContactsRelations = relations(customerContacts, ({ one }) => ({
  customer: one(customers, { fields: [customerContacts.customerId], references: [customers.id] }),
}))

export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export type CustomerContact = typeof customerContacts.$inferSelect
export type CustomerLocation = typeof customerLocations.$inferSelect
