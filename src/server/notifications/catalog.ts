import { can } from '@/lib/permissions'
import type { Actor, AssignmentScope, PermissionKey, ResourceContext, Role } from '@/lib/permissions'

/**
 * The notification event catalog.
 *
 * This is the single place a new event type is defined. `dispatch.ts` never
 * branches on `eventKey` — it reads everything it needs (default channels,
 * the subject kind, the tokens a template may reference, and how to narrow
 * the audience) from the entry here. Adding a fifteenth event is one entry in
 * this object plus a template in `notification.json`; nothing else changes.
 *
 * Event keys follow the same dotted, namespaced convention as
 * `auditActionEnum` (`db/schema/_shared.ts`) — e.g. `onboarding.status_changed`
 * there, `onboarding.corrections_required` here — so the same key doubles as
 * a nested i18n path (`notification.events.onboarding.corrections_required.title`)
 * with no translation required between the two.
 */

export type NotificationChannel = 'in_app' | 'email' | 'sms'

export const NOTIFICATION_EVENT_KEYS = [
  'document.expiring',
  'document.expired',
  'document.rejected',
  'onboarding.corrections_required',
  'onboarding.approved',
  'onboarding.rejected',
  'signature.requested',
  'signature.signed',
  'load.assigned',
  'load.rate_confirmation_requested',
  'invoice.sent',
  'invoice.overdue',
  'expense.rejected',
  'lead.received',
  'export.ready',
] as const

export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number]

/**
 * The minimal shape of a possible recipient, gathered once per tenant by
 * `dispatch.ts`'s `loadNotificationCandidates()`. Deliberately independent of
 * `db/schema` types so this file (and its audience-resolver logic) stays a
 * pure, dependency-free unit — see the `tests/unit/notifications/` suite.
 */
export interface NotificationCandidate {
  userId: string
  role: Role | null
  carrierId?: string | null
  driverId?: string | null
  assignments?: AssignmentScope
}

function emptyAssignments(): AssignmentScope {
  return { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] }
}

/** A throwaway `Actor` good for exactly one thing: `can()`'s scope evaluation. */
function pseudoActor(candidate: NotificationCandidate, tenantId: string | null): Actor {
  return {
    userId: candidate.userId,
    email: '',
    firstName: '',
    lastName: '',
    locale: 'en',
    timezone: 'UTC',
    isPlatformSuperAdmin: false,
    tenantId,
    role: candidate.role,
    carrierId: candidate.carrierId ?? null,
    driverId: candidate.driverId ?? null,
    assignments: candidate.assignments ?? emptyAssignments(),
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: null,
  }
}

export type AudienceResolver = (candidates: NotificationCandidate[], resource: ResourceContext) => string[]

/**
 * The audience resolver every catalog entry below uses: a candidate is in the
 * audience exactly when `can()` would let them read the permission's
 * resource, which is the same scope evaluation (`resourceInScope`) every
 * server action already relies on. This is what keeps a dispatcher from ever
 * being notified about a carrier they cannot see — there is no separate
 * "notification scope" to fall out of sync with the real one.
 */
export function byPermission(permission: PermissionKey): AudienceResolver {
  return (candidates, resource) =>
    candidates
      .filter((candidate) => can(pseudoActor(candidate, resource.tenantId ?? null), permission, resource).allowed)
      .map((candidate) => candidate.userId)
}

export interface NotificationEventDefinition {
  eventKey: NotificationEventKey
  defaultChannels: NotificationChannel[]
  /** Polymorphic subject kind stored on the `notifications` row for grouping/dedupe. */
  subjectType: string
  /** Tokens a template for this event may reference; anything else fails to save. */
  tokens: string[]
  audienceResolver: AudienceResolver
}

export const NOTIFICATION_CATALOG: Record<NotificationEventKey, NotificationEventDefinition> = {
  'document.expiring': {
    eventKey: 'document.expiring',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'document',
    tokens: ['documentType', 'ownerName', 'expirationDate', 'daysRemaining'],
    audienceResolver: byPermission('document:read'),
  },
  'document.expired': {
    eventKey: 'document.expired',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'document',
    tokens: ['documentType', 'ownerName', 'expirationDate'],
    audienceResolver: byPermission('document:read'),
  },
  'document.rejected': {
    eventKey: 'document.rejected',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'document',
    tokens: ['documentType', 'ownerName', 'reason'],
    audienceResolver: byPermission('document:read'),
  },
  'onboarding.corrections_required': {
    eventKey: 'onboarding.corrections_required',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'carrier',
    tokens: ['carrierName', 'notes'],
    audienceResolver: byPermission('carrier:onboarding:read'),
  },
  'onboarding.approved': {
    eventKey: 'onboarding.approved',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'carrier',
    tokens: ['carrierName'],
    audienceResolver: byPermission('carrier:onboarding:read'),
  },
  'onboarding.rejected': {
    eventKey: 'onboarding.rejected',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'carrier',
    tokens: ['carrierName', 'reason'],
    audienceResolver: byPermission('carrier:onboarding:read'),
  },
  'signature.requested': {
    eventKey: 'signature.requested',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'signatureRequest',
    tokens: ['documentTitle', 'signerName'],
    audienceResolver: byPermission('signature:request:read'),
  },
  'signature.signed': {
    eventKey: 'signature.signed',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'signatureRequest',
    tokens: ['documentTitle', 'signerName'],
    audienceResolver: byPermission('signature:request:read'),
  },
  'load.assigned': {
    eventKey: 'load.assigned',
    defaultChannels: ['in_app', 'email', 'sms'],
    subjectType: 'load',
    tokens: ['loadNumber', 'carrierName', 'pickupCity', 'deliveryCity'],
    audienceResolver: byPermission('load:read'),
  },
  'load.rate_confirmation_requested': {
    eventKey: 'load.rate_confirmation_requested',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'load',
    tokens: ['loadNumber', 'carrierName'],
    audienceResolver: byPermission('load:rateconf:respond'),
  },
  'invoice.sent': {
    eventKey: 'invoice.sent',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'invoice',
    tokens: ['invoiceNumber', 'amount', 'dueDate'],
    audienceResolver: byPermission('invoice:read'),
  },
  'invoice.overdue': {
    eventKey: 'invoice.overdue',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'invoice',
    tokens: ['invoiceNumber', 'amount', 'daysOverdue'],
    audienceResolver: byPermission('invoice:read'),
  },
  'expense.rejected': {
    eventKey: 'expense.rejected',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'expense',
    tokens: ['amount', 'category', 'reason'],
    audienceResolver: byPermission('expense:submit'),
  },
  'lead.received': {
    eventKey: 'lead.received',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'lead',
    tokens: ['name', 'company'],
    audienceResolver: byPermission('lead:read'),
  },
  'export.ready': {
    eventKey: 'export.ready',
    defaultChannels: ['in_app', 'email'],
    subjectType: 'export_job',
    tokens: ['reportName', 'format', 'rowCount'],
    // The job handler always passes `recipientUserIds: [job.requestedByUserId]`
    // explicitly, bypassing this resolver — `report:export` is simply the
    // closest-fitting permission for the (never exercised) generic-audience
    // fallback path every other catalog entry also declares.
    audienceResolver: byPermission('report:export'),
  },
}

export function isNotificationEventKey(value: string): value is NotificationEventKey {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_CATALOG, value)
}
