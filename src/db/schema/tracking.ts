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
  primaryId,
  retention,
  timestamps,
  trackingEventTypeEnum,
  trackingProviderEnum,
} from './_shared'
import { tenants } from './tenant'
import { users } from './auth'
import { loads } from './load'
import { drivers } from './driver'
import { trucks } from './equipment'

/* ── Integration credentials ─────────────────────────────────────────────── */

export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** tracking | maps | fmcsa | ocr | email | sms | payments | tolls */
    category: varchar('category', { length: 30 }).notNull(),
    provider: varchar('provider', { length: 40 }).notNull(),
    displayName: varchar('display_name', { length: 120 }),
    enabled: boolean('enabled').notNull().default(false),
    /** Envelope-encrypted credential blob. Never returned to the client. */
    credentialsEncrypted: text('credentials_encrypted'),
    /** Non-secret configuration, safe to render in settings. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** unknown | healthy | degraded | failing */
    healthStatus: varchar('health_status', { length: 20 }).notNull().default('unknown'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastErrorMessage: text('last_error_message'),
    ...auditable,
  },
  (t) => [
    uniqueIndex('integration_connections_uq').on(t.tenantId, t.category, t.provider),
    index('integration_connections_tenant_idx').on(t.tenantId),
  ],
)

/* ── Tracking ────────────────────────────────────────────────────────────── */

export const trackingSessions = pgTable(
  'tracking_sessions',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    truckId: uuid('truck_id').references(() => trucks.id, { onDelete: 'set null' }),
    provider: trackingProviderEnum('provider').notNull().default('mock'),
    providerSessionId: varchar('provider_session_id', { length: 255 }),
    /** No location is ingested until consent is recorded. */
    consentGrantedAt: timestamp('consent_granted_at', { withTimezone: true }),
    consentRevokedAt: timestamp('consent_revoked_at', { withTimezone: true }),
    consentUserId: uuid('consent_user_id').references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** unknown | healthy | stale | lost | ended */
    healthStatus: varchar('health_status', { length: 20 }).notNull().default('unknown'),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    lastLatitude: text('last_latitude'),
    lastLongitude: text('last_longitude'),
    lastLocationLabel: varchar('last_location_label', { length: 200 }),
    routeProgressPercent: integer('route_progress_percent'),
    remainingMiles: integer('remaining_miles'),
    etaAt: timestamp('eta_at', { withTimezone: true }),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('tracking_sessions_tenant_idx').on(t.tenantId),
    index('tracking_sessions_load_idx').on(t.loadId),
    index('tracking_sessions_health_idx').on(t.tenantId, t.healthStatus),
    uniqueIndex('tracking_sessions_provider_uq').on(t.provider, t.providerSessionId),
  ],
)

export const trackingEvents = pgTable(
  'tracking_events',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => trackingSessions.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    provider: trackingProviderEnum('provider').notNull(),
    eventType: trackingEventTypeEnum('event_type').notNull(),
    latitude: text('latitude'),
    longitude: text('longitude'),
    speedMph: integer('speed_mph'),
    headingDegrees: integer('heading_degrees'),
    locationLabel: varchar('location_label', { length: 200 }),
    stopId: uuid('stop_id'),
    /** Provider's own event id — the idempotency key for ingestion. */
    rawProviderReference: varchar('raw_provider_reference', { length: 255 }),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    ...retention,
  },
  (t) => [
    index('tracking_events_tenant_idx').on(t.tenantId),
    index('tracking_events_session_idx').on(t.sessionId, t.occurredAt),
    index('tracking_events_load_idx').on(t.loadId, t.occurredAt),
    uniqueIndex('tracking_events_provider_ref_uq').on(t.provider, t.rawProviderReference),
  ],
)

/**
 * Customers have no accounts; they receive a signed, expiring link that exposes
 * a deliberately narrow projection of one load.
 */
export const publicTrackingLinks = pgTable(
  'public_tracking_links',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    label: varchar('label', { length: 120 }),
    recipientEmail: varchar('recipient_email', { length: 255 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    viewCount: integer('view_count').notNull().default(0),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    ...auditable,
  },
  (t) => [
    uniqueIndex('public_tracking_links_token_uq').on(t.tokenHash),
    index('public_tracking_links_tenant_idx').on(t.tenantId),
    index('public_tracking_links_load_idx').on(t.loadId),
    index('public_tracking_links_expiry_idx').on(t.expiresAt),
  ],
)

export const trackingSessionsRelations = relations(trackingSessions, ({ one, many }) => ({
  load: one(loads, { fields: [trackingSessions.loadId], references: [loads.id] }),
  events: many(trackingEvents),
}))

export type IntegrationConnection = typeof integrationConnections.$inferSelect
export type TrackingSession = typeof trackingSessions.$inferSelect
export type TrackingEvent = typeof trackingEvents.$inferSelect
export type PublicTrackingLink = typeof publicTrackingLinks.$inferSelect
