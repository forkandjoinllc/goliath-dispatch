import { renderTemplateString } from '@/server/notifications/templates'
import type { TranslateFn } from '@/i18n/translate'

/**
 * Canned messages a dispatcher reaches for constantly — "where are you",
 * "please send your POD" — available as a one-click insert in the compose
 * box (`app/messages`'s `MessageTemplatePicker`).
 *
 * There is no `message_templates` table in the schema (`db/schema/messaging.ts`
 * only models conversations/participants/messages/attachments), so this is a
 * fixed catalog rather than tenant-editable rows — each entry's copy lives in
 * `notification.json` under `messaging.templates.<key>` in both languages, and
 * is rendered through the exact same `{{token}}` substitution the tenant
 * notification templates use. A tenant-editable version belongs in the same
 * place `notificationTemplates` lives; noted as a gap in the final report
 * rather than adding a table this agent cannot migrate.
 */

export const MESSAGE_TEMPLATE_KEYS = [
  'whereAreYou',
  'requestPod',
  'requestEta',
  'confirmPickupTime',
  'confirmDeliveryTime',
  'rateConfirmationReminder',
  'documentsNeeded',
] as const

export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number]

export interface MessageTemplateOption {
  key: MessageTemplateKey
  label: string
  body: string
}

/** Resolves every template's label/body in the caller's locale, ready to list in a picker. */
export function listMessageTemplates(t: TranslateFn, tokens: Record<string, string | number> = {}): MessageTemplateOption[] {
  return MESSAGE_TEMPLATE_KEYS.map((key) => ({
    key,
    label: t(`notification.messaging.templates.${key}.label`),
    body: renderTemplateString(t(`notification.messaging.templates.${key}.body`), tokens),
  }))
}
