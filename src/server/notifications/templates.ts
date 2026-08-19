import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { notificationTemplates, type NotificationTemplate } from '@/db/schema'
import type { Locale } from '@/i18n/config'
import type { TranslateFn } from '@/i18n/translate'
import { AppError } from '@/lib/errors'
import { NOTIFICATION_CATALOG, type NotificationChannel, type NotificationEventKey } from './catalog'

/**
 * Tenant notification templates.
 *
 * A tenant may override the built-in copy for any (event, channel, locale)
 * triple; anything it hasn't overridden falls back to
 * `notification.events.<eventKey>.title` / `.body` in `notification.json`
 * (see `renderNotificationContent`), so the product works with zero
 * templates configured. What `templates.ts` guards is the one thing a
 * template must never do: reference a token the event doesn't define — that
 * would render `{{loadNumber}}` verbatim to a carrier instead of failing at
 * save time, where a human can fix it.
 */

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/** Every `{{token}}` referenced in a string, deduplicated. Pure — no i18n, no DB. */
export function extractTemplateTokens(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    found.add(match[1]!)
  }
  return [...found]
}

/** Throws when `subject`/`body` reference a token the event's catalog entry does not list. */
export function validateTemplateTokens(
  eventKey: NotificationEventKey,
  subject: string | null | undefined,
  body: string,
): void {
  const allowed = new Set(NOTIFICATION_CATALOG[eventKey].tokens)
  const used = new Set([...extractTemplateTokens(subject ?? ''), ...extractTemplateTokens(body)])
  const unknown = [...used].filter((token) => !allowed.has(token))
  if (unknown.length > 0) {
    throw new AppError('validation_failed', 'notification.errors.unknownToken', {
      params: { tokens: unknown.join(', ') },
    })
  }
}

/** `{{token}}` → the matching value, or the empty string for a known-but-unsupplied token. */
export function renderTemplateString(template: string, tokens: Record<string, string | number>): string {
  return template.replace(TOKEN_PATTERN, (_match, token: string) => {
    const value = tokens[token]
    return value === undefined || value === null ? '' : String(value)
  })
}

export async function listNotificationTemplates(db: TenantDb): Promise<NotificationTemplate[]> {
  return db.findMany(notificationTemplates)
}

export async function getNotificationTemplate(
  db: TenantDb,
  eventKey: NotificationEventKey,
  channel: NotificationChannel,
  locale: Locale,
): Promise<NotificationTemplate | null> {
  return db.findFirst(notificationTemplates, {
    where: and(
      eq(notificationTemplates.eventKey, eventKey),
      eq(notificationTemplates.channel, channel),
      eq(notificationTemplates.locale, locale),
    )!,
  })
}

export interface UpsertTemplateInput {
  eventKey: NotificationEventKey
  channel: NotificationChannel
  locale: Locale
  subject?: string | null
  body: string
  active?: boolean
}

export async function upsertNotificationTemplate(
  db: TenantDb,
  input: UpsertTemplateInput,
): Promise<NotificationTemplate> {
  validateTemplateTokens(input.eventKey, input.subject, input.body)

  const existing = await getNotificationTemplate(db, input.eventKey, input.channel, input.locale)
  const values = {
    subject: input.subject ?? null,
    body: input.body,
    availableTokens: NOTIFICATION_CATALOG[input.eventKey].tokens,
    active: input.active ?? true,
  }

  if (existing) {
    const updated = await db.update(notificationTemplates, existing.id, values)
    return updated ?? existing
  }

  return db.insert(notificationTemplates, {
    eventKey: input.eventKey,
    channel: input.channel,
    locale: input.locale,
    ...values,
  })
}

export interface RenderedNotificationContent {
  title: string
  body: string
}

/**
 * Resolves the actual title/body a recipient sees: the tenant's active
 * template for (event, channel, locale) if one exists, otherwise the
 * built-in `notification.json` copy for the same event — both rendered
 * through the same `{{token}}` substitution, so the two are interchangeable
 * from a caller's point of view.
 */
export async function renderNotificationContent(
  db: TenantDb,
  t: TranslateFn,
  eventKey: NotificationEventKey,
  channel: NotificationChannel,
  locale: Locale,
  tokens: Record<string, string | number>,
): Promise<RenderedNotificationContent> {
  const custom = await getNotificationTemplate(db, eventKey, channel, locale)
  if (custom && custom.active) {
    return {
      title: renderTemplateString(custom.subject ?? '', tokens),
      body: renderTemplateString(custom.body, tokens),
    }
  }

  return {
    title: t(`notification.events.${eventKey}.title`, tokens),
    body: t(`notification.events.${eventKey}.body`, tokens),
  }
}
