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
  equipmentStatusEnum,
  primaryId,
  retention,
  timestamps,
  verificationStatusEnum,
} from './_shared'
import { tenants, equipmentTypes } from './tenant'
import { users } from './auth'
import { carriers } from './carrier'
import { documents } from './document'

/* ── Trucks ──────────────────────────────────────────────────────────────── */

export const trucks = pgTable(
  'trucks',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id, { onDelete: 'cascade' }),
    unitNumber: varchar('unit_number', { length: 40 }).notNull(),
    vin: varchar('vin', { length: 17 }).notNull(),
    /** Uppercased, O/I/Q-normalized VIN used for exact COI matching. */
    vinNormalized: varchar('vin_normalized', { length: 17 }).notNull(),
    year: integer('year'),
    make: varchar('make', { length: 60 }),
    model: varchar('model', { length: 60 }),
    equipmentTypeId: uuid('equipment_type_id').references(() => equipmentTypes.id),
    plateNumber: varchar('plate_number', { length: 20 }),
    plateState: varchar('plate_state', { length: 2 }),
    status: equipmentStatusEnum('status').notNull().default('pending_verification'),
    vinDecodeSource: varchar('vin_decode_source', { length: 40 }),
    vinDecodedAt: timestamp('vin_decoded_at', { withTimezone: true }),
    registrationNumber: varchar('registration_number', { length: 60 }),
    registrationExpiresAt: timestamp('registration_expires_at', { withTimezone: true }),
    lastInspectionAt: timestamp('last_inspection_at', { withTimezone: true }),
    nextInspectionDueAt: timestamp('next_inspection_due_at', { withTimezone: true }),
    lastMaintenanceAt: timestamp('last_maintenance_at', { withTimezone: true }),
    nextMaintenanceDueAt: timestamp('next_maintenance_due_at', { withTimezone: true }),
    coiVerificationStatus: verificationStatusEnum('coi_verification_status')
      .notNull()
      .default('not_started'),
    outOfServiceReason: text('out_of_service_reason'),
    notes: text('notes'),
    ...auditable,
    ...retention,
  },
  (t) => [
    uniqueIndex('trucks_tenant_vin_uq').on(t.tenantId, t.vinNormalized),
    uniqueIndex('trucks_tenant_carrier_unit_uq').on(t.tenantId, t.carrierId, t.unitNumber),
    index('trucks_tenant_idx').on(t.tenantId),
    index('trucks_carrier_idx').on(t.carrierId),
    index('trucks_status_idx').on(t.tenantId, t.status),
    index('trucks_registration_exp_idx').on(t.tenantId, t.registrationExpiresAt),
  ],
)

/* ── Trailers ────────────────────────────────────────────────────────────── */

export const trailers = pgTable(
  'trailers',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id, { onDelete: 'cascade' }),
    unitNumber: varchar('unit_number', { length: 40 }).notNull(),
    vin: varchar('vin', { length: 17 }).notNull(),
    vinNormalized: varchar('vin_normalized', { length: 17 }).notNull(),
    year: integer('year'),
    make: varchar('make', { length: 60 }),
    model: varchar('model', { length: 60 }),
    equipmentTypeId: uuid('equipment_type_id').references(() => equipmentTypes.id),
    plateNumber: varchar('plate_number', { length: 20 }),
    plateState: varchar('plate_state', { length: 2 }),

    /** Dimensions in inches; capacity in pounds. Imperial units throughout. */
    lengthInches: integer('length_inches'),
    widthInches: integer('width_inches'),
    deckHeightInches: integer('deck_height_inches'),
    wellLengthInches: integer('well_length_inches'),
    capacityPounds: integer('capacity_pounds'),
    axleCount: integer('axle_count'),
    axleConfiguration: varchar('axle_configuration', { length: 60 }),
    removableGooseneck: boolean('removable_gooseneck').notNull().default(false),
    isExtendable: boolean('is_extendable').notNull().default(false),

    status: equipmentStatusEnum('status').notNull().default('pending_verification'),
    registrationNumber: varchar('registration_number', { length: 60 }),
    registrationExpiresAt: timestamp('registration_expires_at', { withTimezone: true }),
    lastInspectionAt: timestamp('last_inspection_at', { withTimezone: true }),
    nextInspectionDueAt: timestamp('next_inspection_due_at', { withTimezone: true }),
    lastMaintenanceAt: timestamp('last_maintenance_at', { withTimezone: true }),
    nextMaintenanceDueAt: timestamp('next_maintenance_due_at', { withTimezone: true }),
    coiVerificationStatus: verificationStatusEnum('coi_verification_status')
      .notNull()
      .default('not_started'),
    outOfServiceReason: text('out_of_service_reason'),
    notes: text('notes'),
    ...auditable,
    ...retention,
  },
  (t) => [
    uniqueIndex('trailers_tenant_vin_uq').on(t.tenantId, t.vinNormalized),
    uniqueIndex('trailers_tenant_carrier_unit_uq').on(t.tenantId, t.carrierId, t.unitNumber),
    index('trailers_tenant_idx').on(t.tenantId),
    index('trailers_carrier_idx').on(t.carrierId),
    index('trailers_status_idx').on(t.tenantId, t.status),
    index('trailers_type_idx').on(t.tenantId, t.equipmentTypeId),
  ],
)

/* ── Media ───────────────────────────────────────────────────────────────── */

export const equipmentMedia = pgTable(
  'equipment_media',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    equipmentType: varchar('equipment_type', { length: 10 }).notNull(), // truck | trailer
    equipmentId: uuid('equipment_id').notNull(),
    /** front | rear | driver_side | passenger_side | interior | detail | video */
    angle: varchar('angle', { length: 20 }).notNull(),
    mediaKind: varchar('media_kind', { length: 10 }).notNull().default('photo'), // photo | video
    storageKey: text('storage_key').notNull(),
    contentType: varchar('content_type', { length: 120 }).notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    caption: varchar('caption', { length: 200 }),
    sortOrder: integer('sort_order').notNull().default(0),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('equipment_media_tenant_idx').on(t.tenantId),
    index('equipment_media_owner_idx').on(t.tenantId, t.equipmentType, t.equipmentId),
  ],
)

/* ── COI / VIN verification ──────────────────────────────────────────────── */

export const equipmentVerifications = pgTable(
  'equipment_verifications',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    equipmentType: varchar('equipment_type', { length: 10 }).notNull(), // truck | trailer
    equipmentId: uuid('equipment_id').notNull(),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id, { onDelete: 'cascade' }),
    /** COI the VINs were extracted from. */
    coiDocumentId: uuid('coi_document_id').references(() => documents.id, { onDelete: 'set null' }),
    coiDocumentVersionId: uuid('coi_document_version_id'),
    status: verificationStatusEnum('status').notNull().default('pending'),
    extractedVins: jsonb('extracted_vins').$type<string[]>().notNull().default([]),
    matchedVin: varchar('matched_vin', { length: 17 }),
    ocrProvider: varchar('ocr_provider', { length: 40 }),
    ocrConfidence: integer('ocr_confidence'),
    mediaCount: integer('media_count').notNull().default(0),
    /** Explicit list of unmet gates, e.g. ['vin_not_on_coi','insufficient_media']. */
    blockingReasons: jsonb('blocking_reasons').$type<string[]>().notNull().default([]),
    overriddenByUserId: uuid('overridden_by_user_id').references(() => users.id),
    overrideReason: text('override_reason'),
    overriddenAt: timestamp('overridden_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('equipment_verifications_tenant_idx').on(t.tenantId),
    index('equipment_verifications_equipment_idx').on(t.tenantId, t.equipmentType, t.equipmentId),
    index('equipment_verifications_carrier_idx').on(t.carrierId),
  ],
)

export const trucksRelations = relations(trucks, ({ one }) => ({
  carrier: one(carriers, { fields: [trucks.carrierId], references: [carriers.id] }),
  equipmentType: one(equipmentTypes, {
    fields: [trucks.equipmentTypeId],
    references: [equipmentTypes.id],
  }),
}))

export const trailersRelations = relations(trailers, ({ one }) => ({
  carrier: one(carriers, { fields: [trailers.carrierId], references: [carriers.id] }),
  equipmentType: one(equipmentTypes, {
    fields: [trailers.equipmentTypeId],
    references: [equipmentTypes.id],
  }),
}))

export type Truck = typeof trucks.$inferSelect
export type NewTruck = typeof trucks.$inferInsert
export type Trailer = typeof trailers.$inferSelect
export type NewTrailer = typeof trailers.$inferInsert
export type EquipmentMedia = typeof equipmentMedia.$inferSelect
export type EquipmentVerification = typeof equipmentVerifications.$inferSelect
