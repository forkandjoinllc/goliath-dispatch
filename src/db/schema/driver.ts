import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
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
  driverStatusEnum,
  localeEnum,
  primaryId,
  retention,
  verificationStatusEnum,
} from './_shared'
import { tenants } from './tenant'
import { users } from './auth'
import { carriers } from './carrier'

export const drivers = pgTable(
  'drivers',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Optional login. A driver record can exist before the person has an account. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    dateOfBirth: date('date_of_birth'),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 32 }),
    preferredLocale: localeEnum('preferred_locale').notNull().default('en'),

    licenseState: varchar('license_state', { length: 2 }),
    /** License number is encrypted at rest; only the last four are displayed. */
    licenseNumberEncrypted: text('license_number_encrypted'),
    licenseNumberLast4: varchar('license_number_last4', { length: 4 }),
    /** Blind index (HMAC) so duplicates can be detected without decryption. */
    licenseNumberHash: varchar('license_number_hash', { length: 64 }),
    cdlClass: varchar('cdl_class', { length: 4 }),
    endorsements: jsonb('endorsements').$type<string[]>().notNull().default([]),
    restrictions: jsonb('restrictions').$type<string[]>().notNull().default([]),
    licenseExpiresAt: timestamp('license_expires_at', { withTimezone: true }),

    medicalCardExpiresAt: timestamp('medical_card_expires_at', { withTimezone: true }),

    status: driverStatusEnum('status').notNull().default('available'),
    verificationStatus: verificationStatusEnum('verification_status')
      .notNull()
      .default('not_started'),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationNotes: text('verification_notes'),

    trackingConsentGrantedAt: timestamp('tracking_consent_granted_at', { withTimezone: true }),
    smsConsentGrantedAt: timestamp('sms_consent_granted_at', { withTimezone: true }),

    notes: text('notes'),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('drivers_tenant_idx').on(t.tenantId),
    index('drivers_tenant_status_idx').on(t.tenantId, t.status),
    index('drivers_tenant_name_idx').on(t.tenantId, t.lastName, t.firstName),
    index('drivers_license_expiry_idx').on(t.tenantId, t.licenseExpiresAt),
    index('drivers_medical_expiry_idx').on(t.tenantId, t.medicalCardExpiresAt),
    uniqueIndex('drivers_tenant_license_hash_uq').on(t.tenantId, t.licenseNumberHash),
    index('drivers_user_idx').on(t.userId),
  ],
)

/**
 * A driver may run for several carriers. The relationship — not the driver — is
 * what a carrier sees, and it always stays inside one tenant.
 */
export const driverCarrierRelationships = pgTable(
  'driver_carrier_relationships',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    startDate: timestamp('start_date', { withTimezone: true }).notNull().defaultNow(),
    endDate: timestamp('end_date', { withTimezone: true }),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...auditable,
  },
  (t) => [
    uniqueIndex('driver_carrier_uq').on(t.tenantId, t.driverId, t.carrierId, t.startDate),
    index('driver_carrier_tenant_idx').on(t.tenantId),
    index('driver_carrier_driver_idx').on(t.driverId),
    index('driver_carrier_carrier_idx').on(t.carrierId),
  ],
)

export const driversRelations = relations(drivers, ({ many, one }) => ({
  carrierRelationships: many(driverCarrierRelationships),
  user: one(users, { fields: [drivers.userId], references: [users.id] }),
}))

export const driverCarrierRelationshipsRelations = relations(
  driverCarrierRelationships,
  ({ one }) => ({
    driver: one(drivers, { fields: [driverCarrierRelationships.driverId], references: [drivers.id] }),
    carrier: one(carriers, {
      fields: [driverCarrierRelationships.carrierId],
      references: [carriers.id],
    }),
  }),
)

export type Driver = typeof drivers.$inferSelect
export type NewDriver = typeof drivers.$inferInsert
export type DriverCarrierRelationship = typeof driverCarrierRelationships.$inferSelect
