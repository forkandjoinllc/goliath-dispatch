import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { notificationPreferences, type NotificationPreference } from '@/db/schema'
import { NOTIFICATION_CATALOG, type NotificationChannel, type NotificationEventKey } from './catalog'

/**
 * Per-user, per-event channel preferences.
 *
 * A user who has never touched their preferences has no row here at all —
 * `resolveChannelsForUser` falls back to the event's `defaultChannels` from
 * the catalog rather than treating "no row" as "no channels".
 */

export interface StoredChannelFlags {
  inApp: boolean
  email: boolean
  sms: boolean
}

/** Pure: turns a stored preference (or its absence) into the channel list `dispatch.ts` sends on. */
export function resolvePreferenceChannels(
  defaultChannels: NotificationChannel[],
  stored: StoredChannelFlags | null,
): NotificationChannel[] {
  if (!stored) return defaultChannels
  const channels: NotificationChannel[] = []
  if (stored.inApp) channels.push('in_app')
  if (stored.email) channels.push('email')
  if (stored.sms) channels.push('sms')
  return channels
}

export async function listUserPreferences(db: TenantDb, userId: string): Promise<NotificationPreference[]> {
  return db.findMany(notificationPreferences, { where: eq(notificationPreferences.userId, userId) })
}

async function findPreference(
  db: TenantDb,
  userId: string,
  eventKey: NotificationEventKey,
): Promise<NotificationPreference | null> {
  return db.findFirst(notificationPreferences, {
    where: and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.eventKey, eventKey))!,
  })
}

/** The channel list `dispatch.ts` actually sends an event on for one recipient. */
export async function resolveChannelsForUser(
  db: TenantDb,
  userId: string,
  eventKey: NotificationEventKey,
): Promise<NotificationChannel[]> {
  const definition = NOTIFICATION_CATALOG[eventKey]
  const stored = await findPreference(db, userId, eventKey)
  return resolvePreferenceChannels(
    definition.defaultChannels,
    stored ? { inApp: stored.inApp, email: stored.email, sms: stored.sms } : null,
  )
}

export interface UpsertPreferenceInput {
  eventKey: NotificationEventKey
  inApp: boolean
  email: boolean
  sms: boolean
}

/** Self-service only — the calling action pins `resource` to `{ ownerUserId: actor.userId }`. */
export async function upsertUserPreference(
  db: TenantDb,
  actor: { userId: string },
  input: UpsertPreferenceInput,
): Promise<NotificationPreference> {
  const existing = await findPreference(db, actor.userId, input.eventKey)
  if (existing) {
    const updated = await db.update(notificationPreferences, existing.id, {
      inApp: input.inApp,
      email: input.email,
      sms: input.sms,
    })
    return updated ?? existing
  }
  return db.insert(notificationPreferences, {
    userId: actor.userId,
    eventKey: input.eventKey,
    inApp: input.inApp,
    email: input.email,
    sms: input.sms,
  })
}
