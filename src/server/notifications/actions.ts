'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import type { Actor, ResourceContext } from '@/lib/permissions'
import { localeSchema } from '@/lib/validation'
import { NOTIFICATION_EVENT_KEYS } from './catalog'
import { upsertUserPreference } from './preferences'
import { upsertNotificationTemplate } from './templates'

/**
 * Server actions for the notification domain: a user's own channel
 * preferences, and a tenant's template copy. Everything else (emitting an
 * event, delivering a channel) is called from inside other domains' own
 * actions/jobs, not exposed here.
 */

const eventKeySchema = z.enum(NOTIFICATION_EVENT_KEYS)

async function ownPreferenceResource(_input: unknown, ctx: { actor: Actor }): Promise<ResourceContext> {
  return { tenantId: ctx.actor.tenantId, ownerUserId: ctx.actor.userId }
}

const updatePreferenceInput = z.object({
  eventKey: eventKeySchema,
  inApp: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
})

export const updateNotificationPreferenceAction = defineAction({
  name: 'notification.preference.update',
  permission: 'notification:preference:update',
  input: updatePreferenceInput,
  resource: ownPreferenceResource,
  handler: (input, ctx) => upsertUserPreference(ctx.db, ctx.actor, input),
})

const upsertTemplateInput = z.object({
  eventKey: eventKeySchema,
  channel: z.enum(['in_app', 'email', 'sms']),
  locale: localeSchema,
  subject: z.string().trim().max(255).optional().nullable(),
  body: z.string().trim().min(1).max(4000),
  active: z.boolean().optional(),
})

/**
 * Template copy is tenant branding/configuration in the same sense
 * `tenant:settings:update` already covers ("branding and templates" per its
 * catalog description) — there is no separate `notification:template:manage`
 * permission, so this reuses that one rather than inventing a role-name
 * check.
 */
export const upsertNotificationTemplateAction = defineAction({
  name: 'notification.template.upsert',
  permission: 'tenant:settings:update',
  input: upsertTemplateInput,
  handler: (input, ctx) => upsertNotificationTemplate(ctx.db, input),
  audit: (input) => ({
    action: 'settings.updated',
    entityType: 'notificationTemplate',
    metadata: { eventKey: input.eventKey, channel: input.channel, locale: input.locale },
  }),
})
