import 'server-only'
import { getEmailProvider, renderEmailShell } from '@/integrations/email'
import type { Locale } from '@/i18n/config'
import { createTranslator, type TranslateParams } from '@/i18n/translate'
import { getDictionary } from '@/i18n/dictionary'
import {
  findPlatformSuperAdminRecipients,
  findTenantAdminRecipients,
  insertInAppNotification,
  type NotifyRecipient,
} from '@/server/platform/marketing-db'
import { logger } from '@/lib/logger'

/**
 * Notifies the people who should hear about a new marketing-site submission
 * (lead, quote request or carrier-signup intent).
 *
 * All database access — including the in-app notification insert, which is
 * cross-tenant from this module's point of view — goes through
 * `src/server/platform/marketing-db.ts` rather than importing `unsafeDb`
 * directly here, consistent with the rest of `src/server/marketing/**`.
 */

export type MarketingNotificationEvent = 'lead.received' | 'quote_request.received' | 'carrier_signup.received'

export interface MarketingNotificationInput {
  event: MarketingNotificationEvent
  tenantId: string | null
  subjectId: string
  subjectType: 'lead' | 'quote_request'
  /** i18n params merged into `marketing.notifications.<event>.title` / `.body`. */
  params: TranslateParams
  actionUrl?: string
}

async function resolveRecipients(tenantId: string | null): Promise<NotifyRecipient[]> {
  if (tenantId) {
    const tenantAdmins = await findTenantAdminRecipients(tenantId)
    if (tenantAdmins.length > 0) return tenantAdmins
  }
  // Platform-level submission (the current default: this site has no tenant
  // context) or a tenant with no Admin on file yet — fall back to whoever
  // administers the platform itself, since a lead otherwise reaches no one.
  return findPlatformSuperAdminRecipients()
}

export async function notifyMarketingSubmission(input: MarketingNotificationInput): Promise<void> {
  const recipients = await resolveRecipients(input.tenantId)
  if (recipients.length === 0) {
    logger.warn('No notification recipients resolved for marketing submission', {
      event: input.event,
      tenantId: input.tenantId ?? undefined,
    })
    return
  }

  const provider = getEmailProvider()

  await Promise.all(
    recipients.map(async (recipient) => {
      const locale: Locale = recipient.locale ?? 'en'
      const dictionary = await getDictionary(locale, ['marketing', 'common'])
      const t = createTranslator(dictionary, locale)
      const title = t(`marketing.notifications.${input.event}.title`, input.params)
      const body = t(`marketing.notifications.${input.event}.body`, input.params)

      // In-app notification. Only meaningful when the recipient belongs to a
      // tenant (the notifications table is tenant-scoped) — platform Super
      // Admins notified for a tenant-less lead have no tenant row to attach
      // one to, so they receive email only. This is the documented fallback
      // referenced in `src/server/marketing/queries.ts`.
      if (input.tenantId) {
        await insertInAppNotification({
          tenantId: input.tenantId,
          userId: recipient.userId,
          eventKey: input.event,
          locale,
          title,
          body,
          actionUrl: input.actionUrl ?? null,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          dedupeKey: `marketing:${input.event}:${input.subjectId}`,
        })
      }

      try {
        const rendered = renderEmailShell({
          locale,
          branding: { tenantDisplayName: 'Goliath Dispatch' },
          bodyHtml: `<p style="font-size:15px;line-height:1.5;color:#111827;">${escapeHtml(body)}</p>`,
          bodyText: body,
        })
        await provider.send({
          to: recipient.email,
          subject: title,
          html: rendered.html,
          text: rendered.text,
          tags: ['marketing', input.event],
          idempotencyKey: `marketing:${input.event}:${input.subjectId}:${recipient.userId}`,
        })
      } catch (error) {
        logger.error('Failed to send marketing notification email', {
          event: input.event,
          recipient: recipient.userId,
          error,
        })
      }
    }),
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
