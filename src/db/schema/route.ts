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
import { auditable, cents, primaryId, retention, timestamps } from './_shared'
import { tenants } from './tenant'
import { users } from './auth'
import { loads } from './load'
import { documents } from './document'

/* ── Routes ──────────────────────────────────────────────────────────────── */

export const routes = pgTable(
  'routes',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 40 }).notNull().default('mock'),
    totalMiles: integer('total_miles'),
    estimatedDurationMinutes: integer('estimated_duration_minutes'),
    estimatedTollCents: cents('estimated_toll_cents'),
    /** Encoded polyline for map rendering. */
    polyline: text('polyline'),
    legs: jsonb('legs')
      .$type<
        Array<{
          fromStopId: string
          toStopId: string
          miles: number
          durationMinutes: number
          states: string[]
        }>
      >()
      .notNull()
      .default([]),
    rawReference: text('raw_reference'),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
    isCurrent: boolean('is_current').notNull().default(true),
    ...auditable,
  },
  (t) => [
    index('routes_tenant_idx').on(t.tenantId),
    index('routes_load_idx').on(t.loadId, t.calculatedAt),
  ],
)

export const routeStates = pgTable(
  'route_states',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    stateCode: varchar('state_code', { length: 2 }).notNull(),
    sequence: integer('sequence').notNull(),
    milesInState: integer('miles_in_state'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('route_states_uq').on(t.routeId, t.stateCode, t.sequence),
    index('route_states_tenant_idx').on(t.tenantId),
  ],
)

/* ── Oversize rules & evaluation ─────────────────────────────────────────── */

/**
 * Per-state legal limits. Seeded with representative federal/state values and
 * fully tenant-editable — these drive guidance, never a legal determination.
 */
export const oversizeRules = pgTable(
  'oversize_rules',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    stateCode: varchar('state_code', { length: 2 }).notNull(),
    maxWidthInches: integer('max_width_inches').notNull().default(102),
    maxHeightInches: integer('max_height_inches').notNull().default(162),
    maxLengthInches: integer('max_length_inches').notNull().default(636),
    maxGrossWeightPounds: integer('max_gross_weight_pounds').notNull().default(80000),
    maxAxleWeightPounds: integer('max_axle_weight_pounds').notNull().default(20000),
    /** Thresholds above which an escort is typically required. */
    escortWidthThresholdInches: integer('escort_width_threshold_inches'),
    escortHeightThresholdInches: integer('escort_height_threshold_inches'),
    escortLengthThresholdInches: integer('escort_length_threshold_inches'),
    policeEscortWidthThresholdInches: integer('police_escort_width_threshold_inches'),
    travelRestrictions: jsonb('travel_restrictions')
      .$type<{
        nightTravelProhibited?: boolean
        weekendTravelProhibited?: boolean
        holidayTravelProhibited?: boolean
        curfewWindows?: Array<{ start: string; end: string; note?: string }>
        notes?: string
      }>()
      .notNull()
      .default({}),
    permitRequiredAboveLegal: boolean('permit_required_above_legal').notNull().default(true),
    permitAuthorityName: varchar('permit_authority_name', { length: 200 }),
    permitAuthorityUrl: varchar('permit_authority_url', { length: 255 }),
    sourceNote: text('source_note'),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    ...auditable,
  },
  (t) => [
    uniqueIndex('oversize_rules_tenant_state_uq').on(t.tenantId, t.stateCode),
    index('oversize_rules_tenant_idx').on(t.tenantId),
  ],
)

export const oversizeEvaluations = pgTable(
  'oversize_evaluations',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    routeId: uuid('route_id').references(() => routes.id, { onDelete: 'set null' }),
    /** clear | oversize | overweight | oversize_overweight | insufficient_data */
    outcome: varchar('outcome', { length: 30 }).notNull(),
    permitLikelyRequired: boolean('permit_likely_required').notNull().default(false),
    escortLikelyRequired: boolean('escort_likely_required').notNull().default(false),
    policeEscortLikelyRequired: boolean('police_escort_likely_required').notNull().default(false),
    /** Inputs are snapshotted so a later dimension change cannot rewrite history. */
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull().default({}),
    stateResults: jsonb('state_results')
      .$type<
        Array<{
          stateCode: string
          exceedances: Array<{ dimension: string; value: number; limit: number; unit: string }>
          permitRequired: boolean
          escortRequired: boolean
          policeEscortRequired: boolean
          travelRestrictions: string[]
          notes: string[]
        }>
      >()
      .notNull()
      .default([]),
    missingDataWarnings: jsonb('missing_data_warnings').$type<string[]>().notNull().default([]),
    /** pending | validated | rejected — Admin sign-off, required before dispatch. */
    humanValidationStatus: varchar('human_validation_status', { length: 20 })
      .notNull()
      .default('pending'),
    validatedByUserId: uuid('validated_by_user_id').references(() => users.id),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    validationNotes: text('validation_notes'),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('oversize_evaluations_tenant_idx').on(t.tenantId),
    index('oversize_evaluations_load_idx').on(t.loadId, t.evaluatedAt),
  ],
)

/* ── Permits & escorts ───────────────────────────────────────────────────── */

export const permits = pgTable(
  'permits',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    stateCode: varchar('state_code', { length: 2 }).notNull(),
    permitNumber: varchar('permit_number', { length: 80 }),
    permitType: varchar('permit_type', { length: 60 }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    costCents: cents('cost_cents').notNull().default(0),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    routeSurveyDocumentId: uuid('route_survey_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    /** pending | requested | issued | expired | rejected | not_required */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    notes: text('notes'),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('permits_tenant_idx').on(t.tenantId),
    index('permits_load_idx').on(t.loadId),
    index('permits_expiry_idx').on(t.tenantId, t.expiresAt),
    uniqueIndex('permits_load_state_number_uq').on(t.loadId, t.stateCode, t.permitNumber),
  ],
)

export const escorts = pgTable(
  'escorts',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    /** pilot_car | police | height_pole | route_survey */
    escortType: varchar('escort_type', { length: 20 }).notNull(),
    stateCode: varchar('state_code', { length: 2 }),
    providerName: varchar('provider_name', { length: 200 }),
    contactName: varchar('contact_name', { length: 200 }),
    contactPhone: varchar('contact_phone', { length: 32 }),
    contactEmail: varchar('contact_email', { length: 255 }),
    agencyName: varchar('agency_name', { length: 200 }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    costCents: cents('cost_cents').notNull().default(0),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    /** pending | confirmed | completed | cancelled | not_required */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    notes: text('notes'),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('escorts_tenant_idx').on(t.tenantId),
    index('escorts_load_idx').on(t.loadId),
  ],
)

export const routesRelations = relations(routes, ({ one, many }) => ({
  load: one(loads, { fields: [routes.loadId], references: [loads.id] }),
  states: many(routeStates),
}))

export type Route = typeof routes.$inferSelect
export type RouteState = typeof routeStates.$inferSelect
export type OversizeRule = typeof oversizeRules.$inferSelect
export type OversizeEvaluation = typeof oversizeEvaluations.$inferSelect
export type Permit = typeof permits.$inferSelect
export type Escort = typeof escorts.$inferSelect
