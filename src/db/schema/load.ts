import { relations, sql } from 'drizzle-orm'
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
  appointmentTypeEnum,
  auditable,
  cents,
  commissionBasisEnum,
  documentTypeEnum,
  loadStatusEnum,
  primaryId,
  retention,
  stopTypeEnum,
  timestamps,
} from './_shared'
import { tenants, equipmentTypes } from './tenant'
import { users } from './auth'
import { carriers } from './carrier'
import { customers, customerContacts, customerLocations } from './customer'
import { drivers } from './driver'
import { trailers, trucks } from './equipment'
import { documents, documentVersions } from './document'

/* ── Loads ───────────────────────────────────────────────────────────────── */

export const loads = pgTable(
  'loads',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Tenant-scoped human identifier, e.g. GD-1042. */
    loadNumber: varchar('load_number', { length: 40 }).notNull(),
    customerReference: varchar('customer_reference', { length: 80 }),
    poNumber: varchar('po_number', { length: 80 }),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    customerContactId: uuid('customer_contact_id').references(() => customerContacts.id),
    /** A load belongs to exactly one carrier and the link is immutable once assigned. */
    carrierId: uuid('carrier_id').references(() => carriers.id),
    carrierLockedAt: timestamp('carrier_locked_at', { withTimezone: true }),
    dispatcherUserId: uuid('dispatcher_user_id').references(() => users.id),

    status: loadStatusEnum('status').notNull().default('draft'),

    commodity: varchar('commodity', { length: 200 }),
    weightPounds: integer('weight_pounds'),
    lengthInches: integer('length_inches'),
    widthInches: integer('width_inches'),
    heightInches: integer('height_inches'),
    pieceCount: integer('piece_count'),
    requiredEquipmentTypeId: uuid('required_equipment_type_id').references(() => equipmentTypes.id),
    isOversize: boolean('is_oversize').notNull().default(false),
    isOverweight: boolean('is_overweight').notNull().default(false),
    axleConfiguration: varchar('axle_configuration', { length: 60 }),
    grossVehicleWeightPounds: integer('gross_vehicle_weight_pounds'),

    /* Financials — every monetary column is integer cents. */
    customerChargeCents: cents('customer_charge_cents').notNull().default(0),
    carrierGrossRateCents: cents('carrier_gross_rate_cents').notNull().default(0),
    /** Percentages captured in basis points and snapshotted per load. */
    carrierDispatchFeeBps: integer('carrier_dispatch_fee_bps').notNull().default(1000),
    dispatcherCommissionBps: integer('dispatcher_commission_bps').notNull().default(2500),
    dispatcherCommissionBasis: commissionBasisEnum('dispatcher_commission_basis')
      .notNull()
      .default('dispatch_fee_amount'),

    miles: integer('miles'),
    deadheadMiles: integer('deadhead_miles'),

    specialInstructions: text('special_instructions'),
    internalNotes: text('internal_notes'),

    /** Timezone-aware planning dates in UTC; display uses stop-local zones. */
    plannedPickupAt: timestamp('planned_pickup_at', { withTimezone: true }),
    plannedDeliveryAt: timestamp('planned_delivery_at', { withTimezone: true }),
    actualPickupAt: timestamp('actual_pickup_at', { withTimezone: true }),
    actualDeliveryAt: timestamp('actual_delivery_at', { withTimezone: true }),
    podReceivedAt: timestamp('pod_received_at', { withTimezone: true }),

    /* Compliance gates */
    permitReadyApprovedByUserId: uuid('permit_ready_approved_by_user_id').references(() => users.id),
    permitReadyApprovedAt: timestamp('permit_ready_approved_at', { withTimezone: true }),
    oversizeValidatedByUserId: uuid('oversize_validated_by_user_id').references(() => users.id),
    oversizeValidatedAt: timestamp('oversize_validated_at', { withTimezone: true }),

    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    duplicatedFromLoadId: uuid('duplicated_from_load_id'),

    ...auditable,
    ...retention,
  },
  (t) => [
    uniqueIndex('loads_tenant_number_uq').on(t.tenantId, t.loadNumber),
    index('loads_tenant_idx').on(t.tenantId),
    index('loads_tenant_status_idx').on(t.tenantId, t.status),
    index('loads_tenant_customer_idx').on(t.tenantId, t.customerId),
    index('loads_tenant_carrier_idx').on(t.tenantId, t.carrierId),
    index('loads_tenant_dispatcher_idx').on(t.tenantId, t.dispatcherUserId),
    index('loads_tenant_pickup_idx').on(t.tenantId, t.plannedPickupAt),
    index('loads_tenant_delivery_idx').on(t.tenantId, t.plannedDeliveryAt),
    index('loads_tenant_reference_idx').on(t.tenantId, t.customerReference),
    index('loads_oversize_idx').on(t.tenantId, t.isOversize),
  ],
)

/* ── Stops ───────────────────────────────────────────────────────────────── */

export const loadStops = pgTable(
  'load_stops',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    stopType: stopTypeEnum('stop_type').notNull(),
    sequence: integer('sequence').notNull(),

    facilityName: varchar('facility_name', { length: 200 }),
    customerLocationId: uuid('customer_location_id').references(() => customerLocations.id),
    line1: varchar('line1', { length: 200 }),
    line2: varchar('line2', { length: 200 }),
    city: varchar('city', { length: 120 }),
    state: varchar('state', { length: 2 }),
    postalCode: varchar('postal_code', { length: 12 }),
    country: varchar('country', { length: 2 }).default('US'),
    latitude: text('latitude'),
    longitude: text('longitude'),
    placeId: varchar('place_id', { length: 255 }),
    /** IANA zone of the facility — appointments display here first. */
    timezone: varchar('timezone', { length: 64 }).notNull().default('America/New_York'),

    contactName: varchar('contact_name', { length: 200 }),
    contactPhone: varchar('contact_phone', { length: 32 }),
    contactEmail: varchar('contact_email', { length: 255 }),
    confirmationNumber: varchar('confirmation_number', { length: 80 }),
    instructions: text('instructions'),

    appointmentType: appointmentTypeEnum('appointment_type').notNull().default('window'),
    windowStart: timestamp('window_start', { withTimezone: true }),
    windowEnd: timestamp('window_end', { withTimezone: true }),
    plannedArrivalAt: timestamp('planned_arrival_at', { withTimezone: true }),
    actualArrivalAt: timestamp('actual_arrival_at', { withTimezone: true }),
    actualDepartureAt: timestamp('actual_departure_at', { withTimezone: true }),
    detentionMinutes: integer('detention_minutes'),
    detentionNotes: text('detention_notes'),

    ...auditable,
  },
  (t) => [
    uniqueIndex('load_stops_load_sequence_uq').on(t.loadId, t.sequence),
    index('load_stops_tenant_idx').on(t.tenantId),
    index('load_stops_load_idx').on(t.loadId),
    index('load_stops_window_idx').on(t.tenantId, t.windowStart),
    index('load_stops_state_idx').on(t.tenantId, t.state),
  ],
)

/* ── Resource assignments ────────────────────────────────────────────────── */

/** A load may use several trucks, trailers and drivers; one row per resource. */
export const loadAssignments = pgTable(
  'load_assignments',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    resourceType: varchar('resource_type', { length: 10 }).notNull(), // truck | trailer | driver
    truckId: uuid('truck_id').references(() => trucks.id),
    trailerId: uuid('trailer_id').references(() => trailers.id),
    driverId: uuid('driver_id').references(() => drivers.id),
    isPrimary: boolean('is_primary').notNull().default(false),
    /** Window the resource is committed for — used by conflict detection. */
    committedFrom: timestamp('committed_from', { withTimezone: true }),
    committedTo: timestamp('committed_to', { withTimezone: true }),
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id),
    unassignedAt: timestamp('unassigned_at', { withTimezone: true }),
    unassignedReason: text('unassigned_reason'),
    /** Snapshot of the compliance evaluation at assignment time. */
    complianceSnapshot: jsonb('compliance_snapshot').$type<Record<string, unknown>>(),
    ...auditable,
  },
  (t) => [
    index('load_assignments_tenant_idx').on(t.tenantId),
    index('load_assignments_load_idx').on(t.loadId),
    index('load_assignments_truck_idx').on(t.tenantId, t.truckId, t.committedFrom),
    index('load_assignments_trailer_idx').on(t.tenantId, t.trailerId, t.committedFrom),
    index('load_assignments_driver_idx').on(t.tenantId, t.driverId, t.committedFrom),
    uniqueIndex('load_assignments_truck_uq')
      .on(t.loadId, t.truckId)
      .where(sql`truck_id is not null and unassigned_at is null`),
    uniqueIndex('load_assignments_trailer_uq')
      .on(t.loadId, t.trailerId)
      .where(sql`trailer_id is not null and unassigned_at is null`),
    uniqueIndex('load_assignments_driver_uq')
      .on(t.loadId, t.driverId)
      .where(sql`driver_id is not null and unassigned_at is null`),
  ],
)

/* ── Status history ──────────────────────────────────────────────────────── */

export const loadStatusHistory = pgTable(
  'load_status_history',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    fromStatus: loadStatusEnum('from_status'),
    toStatus: loadStatusEnum('to_status').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    /** user | tracking_provider | system_job | webhook */
    source: varchar('source', { length: 24 }).notNull().default('user'),
    sourceReference: varchar('source_reference', { length: 120 }),
    notes: text('notes'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('load_status_history_tenant_idx').on(t.tenantId),
    index('load_status_history_load_idx').on(t.loadId, t.occurredAt),
  ],
)

/* ── Load documents & rate confirmation ──────────────────────────────────── */

export const loadDocuments = pgTable(
  'load_documents',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    documentType: documentTypeEnum('document_type').notNull(),
    stopId: uuid('stop_id').references(() => loadStops.id, { onDelete: 'set null' }),
    ...auditable,
  },
  (t) => [
    uniqueIndex('load_documents_uq').on(t.loadId, t.documentId),
    index('load_documents_tenant_idx').on(t.tenantId),
    index('load_documents_load_type_idx').on(t.loadId, t.documentType),
  ],
)

export const rateConfirmationAcceptances = pgTable(
  'rate_confirmation_acceptances',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id),
    /** accepted | rejected | changes_requested */
    decision: varchar('decision', { length: 20 }).notNull(),
    decisionReason: text('decision_reason'),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    /** SHA-256 of the exact PDF bytes the carrier saw. */
    documentSha256: varchar('document_sha256', { length: 64 }).notNull(),
    ratedAmountCents: cents('rated_amount_cents'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    ...retention,
  },
  (t) => [
    index('rate_confirmation_tenant_idx').on(t.tenantId),
    index('rate_confirmation_load_idx').on(t.loadId, t.decidedAt),
  ],
)

/* ── Check calls ─────────────────────────────────────────────────────────── */

export const checkCalls = pgTable(
  'check_calls',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByUserId: uuid('completed_by_user_id').references(() => users.id),
    /** scheduled | provider_event | manual */
    origin: varchar('origin', { length: 20 }).notNull().default('scheduled'),
    notes: text('notes'),
    locationSummary: varchar('location_summary', { length: 200 }),
    ...auditable,
  },
  (t) => [
    index('check_calls_tenant_idx').on(t.tenantId),
    index('check_calls_load_idx').on(t.loadId, t.scheduledFor),
    index('check_calls_due_idx').on(t.tenantId, t.completedAt, t.scheduledFor),
  ],
)

/* ── Relations ───────────────────────────────────────────────────────────── */

export const loadsRelations = relations(loads, ({ one, many }) => ({
  customer: one(customers, { fields: [loads.customerId], references: [customers.id] }),
  carrier: one(carriers, { fields: [loads.carrierId], references: [carriers.id] }),
  dispatcher: one(users, { fields: [loads.dispatcherUserId], references: [users.id] }),
  stops: many(loadStops),
  assignments: many(loadAssignments),
  statusHistory: many(loadStatusHistory),
  documents: many(loadDocuments),
}))

export const loadStopsRelations = relations(loadStops, ({ one }) => ({
  load: one(loads, { fields: [loadStops.loadId], references: [loads.id] }),
}))

export const loadAssignmentsRelations = relations(loadAssignments, ({ one }) => ({
  load: one(loads, { fields: [loadAssignments.loadId], references: [loads.id] }),
  truck: one(trucks, { fields: [loadAssignments.truckId], references: [trucks.id] }),
  trailer: one(trailers, { fields: [loadAssignments.trailerId], references: [trailers.id] }),
  driver: one(drivers, { fields: [loadAssignments.driverId], references: [drivers.id] }),
}))

export type Load = typeof loads.$inferSelect
export type NewLoad = typeof loads.$inferInsert
export type LoadStop = typeof loadStops.$inferSelect
export type NewLoadStop = typeof loadStops.$inferInsert
export type LoadAssignment = typeof loadAssignments.$inferSelect
export type LoadStatusHistoryRow = typeof loadStatusHistory.$inferSelect
export type RateConfirmationAcceptance = typeof rateConfirmationAcceptances.$inferSelect
export type CheckCall = typeof checkCalls.$inferSelect
