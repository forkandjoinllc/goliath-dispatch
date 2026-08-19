import 'server-only'
import { and, desc, eq, ne } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { consentRecords, notifications, type Notification } from '@/db/schema'
import { getEmailProvider, renderEmailShell } from '@/integrations/email'
import { getSmsProvider, toE164Us } from '@/integrations/sms'
import { getTenant } from '@/server/context'
import { loadRecipientProfile } from './dispatch'

/**
 * Channel senders.
 *
 * In-app delivery is the `notifications` row itself — `dispatch.ts` marks it
 * `delivered` the moment it is written, so this module has nothing to do for
 * that channel. Email and SMS rows are written `queued` and drained here,
 * either by the `notification.deliver` job (`jobQueue`, enqueued by
 * `dispatch.ts`) or by calling `deliverNotification` directly, which is what
 * the unit tests below exercise without a real queue worker.
 */

export interface SmsConsentRecord {
  granted: boolean
  revokedAt: Date | null
}

/**
 * Pure: the actual "does this person allow SMS" decision, given whatever
 * consent rows exist. Only the newest one counts (a later grant can follow
 * an earlier revocation, and vice versa) — separated from the DB read so it
 * is directly unit-testable.
 */
export function hasActiveSmsConsent(records: SmsConsentRecord[]): boolean {
  if (records.length === 0) return false
  const [latest] = records
  return Boolean(latest!.granted && !latest!.revokedAt)
}

/** Reads every `sms` consent row for a user, newest first, for `hasActiveSmsConsent`. */
export async function loadSmsConsentRecords(db: TenantDb, userId: string): Promise<SmsConsentRecord[]> {
  const rows = await db.builderRequiringExplicitTenantPredicate
    .select({ granted: consentRecords.granted, revokedAt: consentRecords.revokedAt })
    .from(consentRecords)
    .where(and(eq(consentRecords.userId, userId), eq(consentRecords.consentType, 'sms')))
    .orderBy(desc(consentRecords.createdAt))
  return rows
}

export interface DeliveryOutcome {
  status: 'sent' | 'failed' | 'suppressed'
  providerMessageId?: string
  failureReason?: string
}

/** Renders and sends one email notification. Never called for a `sms`/`in_app` row. */
async function deliverEmail(notification: Notification, to: string, tenantName: string): Promise<DeliveryOutcome> {
  const provider = getEmailProvider()
  const rendered = renderEmailShell({
    locale: notification.locale,
    branding: { tenantDisplayName: tenantName },
    bodyHtml: `<p style="font-size:15px;line-height:1.5;color:#111827;">${escapeHtml(notification.body)}</p>`,
    bodyText: notification.body,
  })
  try {
    const result = await provider.send({
      to,
      subject: notification.title,
      html: rendered.html,
      text: rendered.text,
      tags: ['notification', notification.eventKey],
      idempotencyKey: `notification:${notification.id}`,
    })
    return { status: 'sent', providerMessageId: result.providerMessageId }
  } catch (error) {
    return { status: 'failed', failureReason: error instanceof Error ? error.message : 'email_send_failed' }
  }
}

/**
 * Sends one SMS notification, but only when `consentGranted` is true — the
 * caller (`deliverNotification`) is the one place that decides that, from a
 * real consent record, and it is never hardcoded `true` here or anywhere
 * downstream (`assertSmsConsent` in `integrations/sms/provider.ts` would
 * throw if it were).
 */
async function deliverSms(notification: Notification, to: string, consentGranted: boolean): Promise<DeliveryOutcome> {
  if (!consentGranted) {
    return { status: 'suppressed', failureReason: 'sms_consent_missing' }
  }
  const e164 = toE164Us(to)
  if (!e164) {
    return { status: 'failed', failureReason: 'invalid_phone_number' }
  }
  const provider = getSmsProvider()
  try {
    const result = await provider.send({
      to: e164,
      body: `${notification.title}\n${notification.body}`,
      consentGranted: true,
      idempotencyKey: `notification:${notification.id}`,
    })
    return { status: 'sent', providerMessageId: result.providerMessageId }
  } catch (error) {
    return { status: 'failed', failureReason: error instanceof Error ? error.message : 'sms_send_failed' }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Drains one queued `notifications` row. Idempotent: a row that is not
 * `channel: 'email' | 'sms'` and `status: 'queued'` is returned unchanged, so
 * the job worker retrying a lease it already completed is harmless.
 */
export async function deliverNotification(db: TenantDb, notificationId: string): Promise<Notification> {
  const notification = await db.requireById(notifications, notificationId, 'notification')
  if (notification.channel === 'in_app' || notification.status !== 'queued') {
    return notification
  }

  const profile = await loadRecipientProfile(db, notification.userId)
  if (!profile) {
    const updated = await db.update(notifications, notificationId, {
      status: 'failed',
      failureReason: 'recipient_not_found',
    })
    return updated ?? notification
  }

  let outcome: DeliveryOutcome
  if (notification.channel === 'email') {
    const tenant = await getTenant(db.tenantId)
    outcome = await deliverEmail(notification, profile.email, tenant?.displayName ?? 'Goliath Dispatch')
  } else {
    const consentGranted = hasActiveSmsConsent(await loadSmsConsentRecords(db, notification.userId))
    outcome = await deliverSms(notification, profile.phone ?? '', consentGranted)
  }

  const updated = await db.update(notifications, notificationId, {
    status: outcome.status,
    providerMessageId: outcome.providerMessageId ?? null,
    failureReason: outcome.failureReason ?? null,
    sentAt: outcome.status === 'sent' ? new Date() : null,
  })
  return updated ?? notification
}

/** Every queued email/sms row still awaiting delivery — what the `notification.deliver` job drains. */
export async function listQueuedNotifications(db: TenantDb, limit = 100): Promise<Notification[]> {
  return db.findMany(notifications, {
    where: and(eq(notifications.status, 'queued'), ne(notifications.channel, 'in_app'))!,
    limit,
  })
}
