import { relations } from 'drizzle-orm'
import {
  bigint,
  boolean,
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
  localeEnum,
  notificationChannelEnum,
  notificationStatusEnum,
  primaryId,
  retention,
  roleEnum,
} from './_shared'
import { tenants } from './tenant'
import { users } from './auth'
import { loads } from './load'
import { carriers } from './carrier'

/* ── Conversations ───────────────────────────────────────────────────────── */

export const conversations = pgTable(
  'conversations',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subject: varchar('subject', { length: 200 }),
    loadId: uuid('load_id').references(() => loads.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id').references(() => carriers.id, { onDelete: 'cascade' }),
    /** direct | load | broadcast */
    kind: varchar('kind', { length: 20 }).notNull().default('direct'),
    /** Flags operationally sensitive threads for audit retention. */
    isOperational: boolean('is_operational').notNull().default(false),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('conversations_tenant_idx').on(t.tenantId),
    index('conversations_load_idx').on(t.loadId),
    index('conversations_last_message_idx').on(t.tenantId, t.lastMessageAt),
  ],
)

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    mutedAt: timestamp('muted_at', { withTimezone: true }),
    leftAt: timestamp('left_at', { withTimezone: true }),
    ...auditable,
  },
  (t) => [
    uniqueIndex('conversation_participants_uq').on(t.conversationId, t.userId),
    index('conversation_participants_tenant_idx').on(t.tenantId),
    index('conversation_participants_user_idx').on(t.tenantId, t.userId),
  ],
)

export const messages = pgTable(
  'messages',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderUserId: uuid('sender_user_id').references(() => users.id),
    /** user | system — system messages narrate status changes in the thread. */
    origin: varchar('origin', { length: 12 }).notNull().default('user'),
    body: text('body').notNull(),
    /** For system messages: i18n key + params instead of hard-coded text. */
    systemKey: varchar('system_key', { length: 80 }),
    systemParams: jsonb('system_params').$type<Record<string, string | number>>(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('messages_tenant_idx').on(t.tenantId),
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
  ],
)

export const messageAttachments = pgTable(
  'message_attachments',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 120 }).notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('message_attachments_tenant_idx').on(t.tenantId),
    index('message_attachments_message_idx').on(t.messageId),
  ],
)

/* ── Notifications ───────────────────────────────────────────────────────── */

/**
 * Event-driven. New event types are added to the catalog, not to the delivery
 * pipeline — templates and preferences resolve by `eventKey` at send time.
 */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventKey: varchar('event_key', { length: 80 }).notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    locale: localeEnum('locale').notNull(),
    subject: varchar('subject', { length: 255 }),
    body: text('body').notNull(),
    /** Tokens the template may reference, e.g. {{loadNumber}}. */
    availableTokens: jsonb('available_tokens').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    ...auditable,
  },
  (t) => [
    uniqueIndex('notification_templates_uq').on(t.tenantId, t.eventKey, t.channel, t.locale),
    index('notification_templates_tenant_idx').on(t.tenantId),
  ],
)

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventKey: varchar('event_key', { length: 80 }).notNull(),
    inApp: boolean('in_app').notNull().default(true),
    email: boolean('email').notNull().default(true),
    sms: boolean('sms').notNull().default(false),
    ...auditable,
  },
  (t) => [
    uniqueIndex('notification_preferences_uq').on(t.tenantId, t.userId, t.eventKey),
    index('notification_preferences_tenant_user_idx').on(t.tenantId, t.userId),
  ],
)

export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventKey: varchar('event_key', { length: 80 }).notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    status: notificationStatusEnum('status').notNull().default('queued'),
    locale: localeEnum('locale').notNull().default('en'),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body').notNull(),
    /** Deep link into the app, e.g. /en/app/loads/<id>. */
    actionUrl: varchar('action_url', { length: 500 }),
    /** Polymorphic subject for grouping and dedupe. */
    subjectType: varchar('subject_type', { length: 30 }),
    subjectId: uuid('subject_id'),
    /** Stable key that makes repeat sweeps idempotent. */
    dedupeKey: varchar('dedupe_key', { length: 200 }),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    failureReason: text('failure_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('notifications_tenant_idx').on(t.tenantId),
    index('notifications_user_unread_idx').on(t.tenantId, t.userId, t.readAt),
    index('notifications_event_idx').on(t.tenantId, t.eventKey),
    uniqueIndex('notifications_dedupe_uq').on(t.dedupeKey, t.userId, t.channel),
  ],
)

export const conversationsRelations = relations(conversations, ({ many, one }) => ({
  participants: many(conversationParticipants),
  messages: many(messages),
  load: one(loads, { fields: [conversations.loadId], references: [loads.id] }),
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  attachments: many(messageAttachments),
}))

export type Conversation = typeof conversations.$inferSelect
export type Message = typeof messages.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type NotificationTemplate = typeof notificationTemplates.$inferSelect
export type NotificationPreference = typeof notificationPreferences.$inferSelect
