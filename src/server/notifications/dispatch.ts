import 'server-only'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { tenantDb, type TenantDb } from '@/db/tenant-db'
import {
  carrierDispatcherAssignments,
  jobQueue,
  notifications,
  userTenantMemberships,
  users,
  type Notification,
} from '@/db/schema'
import type { Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import type { ResourceContext, Role } from '@/lib/permissions'
import { NOTIFICATION_CATALOG, type NotificationCandidate, type NotificationChannel, type NotificationEventKey } from './catalog'
import { resolveChannelsForUser } from './preferences'
import { renderNotificationContent } from './templates'

/**
 * The event dispatcher.
 *
 * `emitNotification` is the one function every domain (onboarding, documents,
 * signatures, loads, invoices, expenses, the marketing lead queue) calls to
 * turn a business event into recipient-facing notifications. It never
 * branches on `eventKey` beyond looking the key up in `NOTIFICATION_CATALOG`
 * — everything event-specific (who should hear about it, what channels, what
 * copy) comes from that one table.
 */

/**
 * Stable across repeated calls for the same (event, subject, channel[,
 * suffix]) — which is what makes a daily sweep idempotent: re-running it for
 * a document whose expiration date hasn't changed produces the same key every
 * morning, and `notifications_dedupe_uq` (plus the pre-insert check below)
 * ensures only the first call ever creates a row. Pure and DB-free so it is
 * directly unit-testable.
 */
export function buildDedupeKey(
  eventKey: NotificationEventKey,
  subject: { type: string; id: string },
  channel: NotificationChannel,
  suffix?: string,
): string {
  const base = `${eventKey}:${subject.type}:${subject.id}`
  return suffix ? `${base}:${suffix}:${channel}` : `${base}:${channel}`
}

/** Every user in the tenant who could conceivably be an audience member, with just enough scope data to filter. */
async function loadNotificationCandidates(db: TenantDb): Promise<NotificationCandidate[]> {
  const memberships = await db.builderRequiringExplicitTenantPredicate
    .select({
      userId: userTenantMemberships.userId,
      role: userTenantMemberships.role,
      carrierId: userTenantMemberships.carrierId,
      driverId: userTenantMemberships.driverId,
    })
    .from(userTenantMemberships)
    .where(
      and(
        eq(userTenantMemberships.tenantId, db.tenantId),
        eq(userTenantMemberships.status, 'active'),
        isNull(userTenantMemberships.deletedAt),
      ),
    )

  const dispatcherUserIds = memberships.filter((m) => m.role === 'dispatcher').map((m) => m.userId)
  const assignmentsByUser = new Map<string, string[]>()

  if (dispatcherUserIds.length > 0) {
    const assignments = await db.findMany(carrierDispatcherAssignments, {
      where: and(
        inArray(carrierDispatcherAssignments.dispatcherUserId, dispatcherUserIds),
        isNull(carrierDispatcherAssignments.endDate),
      )!,
    })
    for (const assignment of assignments) {
      const list = assignmentsByUser.get(assignment.dispatcherUserId) ?? []
      list.push(assignment.carrierId)
      assignmentsByUser.set(assignment.dispatcherUserId, list)
    }
  }

  return memberships.map((m) => ({
    userId: m.userId,
    role: m.role as Role,
    carrierId: m.carrierId,
    driverId: m.driverId,
    assignments: {
      carrierIds: assignmentsByUser.get(m.userId) ?? [],
      truckIds: [],
      trailerIds: [],
      driverIds: [],
      groupIds: [],
    },
  }))
}

/** `users` has no `tenant_id` column — membership is what proves tenancy (see `carriers/queries.ts`'s `onboardingBoard`). */
export async function loadRecipientProfile(
  db: TenantDb,
  userId: string,
): Promise<{ locale: Locale; email: string; phone: string | null } | null> {
  const rows = await db.builderRequiringExplicitTenantPredicate
    .select({ locale: users.locale, email: users.email, phone: users.phone })
    .from(users)
    .innerJoin(
      userTenantMemberships,
      and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, db.tenantId)),
    )
    .where(eq(users.id, userId))
    .limit(1)
  const row = rows[0]
  return row ? { locale: row.locale as Locale, email: row.email, phone: row.phone } : null
}

async function enqueueDeliveryJob(db: TenantDb, notificationId: string): Promise<void> {
  const dedupeKey = `notification.deliver:${notificationId}`
  const alreadyQueued = await db.exists(jobQueue, eq(jobQueue.dedupeKey, dedupeKey))
  if (alreadyQueued) return
  await db.insert(jobQueue, { jobType: 'notification.deliver', payload: { notificationId }, dedupeKey })
}

export interface EmitNotificationInput {
  tenantId: string
  eventKey: NotificationEventKey
  subject: { type: string; id: string }
  /** Token values for the rendered copy. Keys outside the event's catalog `tokens` are ignored, never validated here — that happens at template save time. */
  tokens?: Record<string, string | number>
  /** Resource facts (e.g. `{ carrierId }`) used to scope the audience via the event's permission. Tenant-wide (admins/accounting) when omitted. */
  audience?: ResourceContext
  /** Bypasses the audience resolver entirely — for a signer or submitter the caller already knows by id. */
  recipientUserIds?: string[]
  actionUrl?: string
  /** Distinguishes repeat occurrences of the same event for the same subject (e.g. an expiration date) from a true duplicate. */
  dedupeSuffix?: string
}

export interface EmitNotificationResult {
  notifications: Notification[]
}

/**
 * Resolves recipients, applies each one's channel preferences, renders the
 * content in their locale, and writes one `notifications` row per
 * (recipient, channel) — skipping any combination whose dedupe key already
 * exists. In-app rows are their own delivery (`status: 'delivered'`
 * immediately); email/sms rows are queued and a `notification.deliver` job
 * is enqueued for `delivery.ts` to drain.
 */
export async function emitNotification(input: EmitNotificationInput): Promise<EmitNotificationResult> {
  const definition = NOTIFICATION_CATALOG[input.eventKey]
  const db = tenantDb(input.tenantId)
  const resource: ResourceContext = { tenantId: input.tenantId, ...(input.audience ?? {}) }

  const recipientUserIds =
    input.recipientUserIds ?? definition.audienceResolver(await loadNotificationCandidates(db), resource)
  const uniqueRecipients = [...new Set(recipientUserIds)]
  if (uniqueRecipients.length === 0) return { notifications: [] }

  const created: Notification[] = []

  for (const userId of uniqueRecipients) {
    const profile = await loadRecipientProfile(db, userId)
    if (!profile) continue

    const channels = await resolveChannelsForUser(db, userId, input.eventKey)
    if (channels.length === 0) continue

    const dictionary = await getDictionary(profile.locale, ['notification', 'common'])
    const t = createTranslator(dictionary, profile.locale)

    for (const channel of channels) {
      const dedupeKey = buildDedupeKey(input.eventKey, input.subject, channel, input.dedupeSuffix)
      const alreadyExists = await db.exists(
        notifications,
        and(
          eq(notifications.dedupeKey, dedupeKey),
          eq(notifications.userId, userId),
          eq(notifications.channel, channel),
        )!,
      )
      if (alreadyExists) continue

      const rendered = await renderNotificationContent(
        db,
        t,
        input.eventKey,
        channel,
        profile.locale,
        input.tokens ?? {},
      )

      const now = new Date()
      const row = await db.insert(notifications, {
        userId,
        eventKey: input.eventKey,
        channel,
        status: channel === 'in_app' ? 'delivered' : 'queued',
        locale: profile.locale,
        title: rendered.title,
        body: rendered.body,
        actionUrl: input.actionUrl ?? null,
        subjectType: definition.subjectType,
        subjectId: input.subject.id,
        dedupeKey,
        sentAt: channel === 'in_app' ? now : null,
      })
      created.push(row)

      if (channel !== 'in_app') {
        await enqueueDeliveryJob(db, row.id)
      }
    }
  }

  return { notifications: created }
}
