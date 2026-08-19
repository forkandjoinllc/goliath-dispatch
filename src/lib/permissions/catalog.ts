import type { Role, Scope } from './types'

/**
 * The permission catalog and the role matrix.
 *
 * This file is the single authoritative statement of who may do what. It is
 * mirrored into the `permissions` / `role_permissions` tables by the seed so the
 * database can be queried for reporting, but the runtime check reads from here —
 * one source, no drift, and a matrix that is diffable in review.
 *
 * docs/permissions.md is generated from this file (`npm run docs:permissions`).
 */

export const PERMISSIONS = {
  /* ── Platform ───────────────────────────────────────────────────────── */
  'platform:tenant:read': 'View any tenant on the platform',
  'platform:tenant:create': 'Create a tenant',
  'platform:tenant:suspend': 'Suspend or reactivate a tenant',
  'platform:tenant:support_access': 'Open an explicit support-access session into a tenant',
  'platform:plan:read': 'View SaaS plans and subscription status',
  'platform:plan:manage': 'Create and edit SaaS plans',
  'platform:health:read': 'View platform health and usage',
  'platform:impersonate': 'Impersonate a tenant user',

  /* ── Tenant administration ──────────────────────────────────────────── */
  'tenant:settings:read': 'View tenant settings',
  'tenant:settings:update': 'Change tenant settings, branding and templates',
  'tenant:user:read': 'View users in the tenant',
  'tenant:user:invite': 'Invite a user',
  'tenant:user:update': 'Edit a user, role or status',
  'tenant:user:suspend': 'Suspend or reactivate a user',
  'tenant:impersonate': 'Impersonate a user inside the tenant',
  'tenant:integration:read': 'View integration connections',
  'tenant:integration:update': 'Configure integration credentials',
  'tenant:billing:read': 'View the tenant subscription and invoices from the platform',
  'tenant:billing:update': 'Change the tenant subscription',

  /* ── Assignments ────────────────────────────────────────────────────── */
  'assignment:read': 'View dispatcher assignments and groups',
  'assignment:manage': 'Assign carriers, equipment, drivers and groups to dispatchers',
  'assignment:commission:update': 'Set dispatcher commission percentages',

  /* ── Carriers & onboarding ──────────────────────────────────────────── */
  'carrier:read': 'View carriers',
  'carrier:create': 'Create a carrier',
  'carrier:update': 'Edit carrier company data',
  'carrier:delete': 'Soft-delete a carrier',
  'carrier:fee:update': 'Set the carrier dispatch fee percentage',
  'carrier:onboarding:read': 'View onboarding status and checklist',
  'carrier:onboarding:submit': 'Submit onboarding for review',
  'carrier:onboarding:review': 'Move onboarding through review states',
  'carrier:onboarding:approve': 'Approve or reject carrier onboarding',
  'carrier:verification:read': 'View FMCSA verification results',
  'carrier:verification:run': 'Trigger an FMCSA verification',
  'carrier:verification:override': 'Manually override a failed verification with a reason',

  /* ── Documents ──────────────────────────────────────────────────────── */
  'document:read': 'View document metadata',
  'document:download': 'Download the document file',
  'document:upload': 'Upload a document or a new version',
  'document:review': 'Approve or reject a document',
  'document:delete': 'Soft-delete a document',

  /* ── Signatures ─────────────────────────────────────────────────────── */
  'signature:template:read': 'View signature templates',
  'signature:template:manage': 'Create and version signature templates',
  'signature:request:create': 'Send a signature request',
  'signature:request:read': 'View signature requests and their status',
  'signature:sign': 'Sign a document addressed to you',
  'signature:void': 'Void a signature request',
  'signature:certificate:download': 'Download the audit certificate',

  /* ── Equipment ──────────────────────────────────────────────────────── */
  'equipment:read': 'View trucks and trailers',
  'equipment:create': 'Add a truck or trailer',
  'equipment:update': 'Edit a truck or trailer',
  'equipment:status:update': 'Change equipment status (active / out of service)',
  'equipment:verification:override': 'Approve equipment despite a COI/VIN mismatch',
  'equipment:type:manage': 'Add or edit trailer and equipment types',
  'equipment:media:upload': 'Upload equipment photos and video',

  /* ── Drivers ────────────────────────────────────────────────────────── */
  'driver:read': 'View drivers',
  'driver:create': 'Add a driver',
  'driver:update': 'Edit a driver',
  'driver:approve': 'Approve a driver after licence review',
  'driver:self:update': 'Edit your own driver profile and documents',

  /* ── Customers ──────────────────────────────────────────────────────── */
  'customer:read': 'View customers and contacts',
  'customer:create': 'Create a customer',
  'customer:update': 'Edit a customer or contact',
  'customer:duplicate:override': 'Create a customer despite a duplicate warning',
  'customer:delete': 'Soft-delete a customer',

  /* ── Loads ──────────────────────────────────────────────────────────── */
  'load:read': 'View loads',
  'load:create': 'Create a load',
  'load:update': 'Edit load details',
  'load:status:update': 'Change a load status',
  'load:cancel': 'Cancel a load',
  'load:duplicate': 'Duplicate a load',
  'load:assign_resources': 'Assign trucks, trailers and drivers to a load',
  'load:assign_carrier': 'Assign the carrier to a load',
  'load:financials:read': 'View load financial figures',
  'load:financials:update': 'Edit load rates and fee percentages',
  'load:rateconf:respond': 'Accept, reject or request changes to a rate confirmation',
  'load:document:upload': 'Upload load documents (BOL, POD, receipts)',

  /* ── Routes, oversize, permits ──────────────────────────────────────── */
  'route:calculate': 'Calculate or recalculate a route',
  'oversize:evaluate': 'Run an oversize / overweight evaluation',
  'oversize:validate': 'Sign off on an oversize evaluation',
  'oversize:rule:manage': 'Edit state oversize rules',
  'permit:read': 'View permits and escorts',
  'permit:manage': 'Create and edit permits and escorts',
  'permit:approve_ready': 'Approve a load as permit-ready for dispatch',

  /* ── Tracking ───────────────────────────────────────────────────────── */
  'tracking:read': 'View tracking sessions and location history',
  'tracking:manage': 'Start, stop and reconfigure tracking for a load',
  'tracking:consent': 'Grant or revoke tracking consent for yourself',
  'tracking:link:create': 'Create a public customer tracking link',
  'tracking:link:revoke': 'Revoke a public tracking link',

  /* ── Messaging ──────────────────────────────────────────────────────── */
  'message:read': 'Read conversations you participate in',
  'message:send': 'Send messages',
  'message:template:manage': 'Manage message, email and SMS templates',
  'notification:preference:update': 'Change your notification preferences',

  /* ── Financials ─────────────────────────────────────────────────────── */
  'expense:read': 'View expenses',
  'expense:submit': 'Submit an expense and receipt',
  'expense:approve': 'Approve or reject an expense',
  'expense:category:manage': 'Manage expense categories and their treatment',
  'finance:read': 'View financial records and margins',
  'finance:update': 'Edit financial records',
  'invoice:read': 'View invoices',
  'invoice:create': 'Create or regenerate an invoice',
  'invoice:send': 'Send an invoice',
  'invoice:status:update': 'Change invoice status, void or write off',
  'invoice:pay': 'Pay an invoice',
  'payment:record': 'Record a manual payment',
  'payment:refund': 'Refund a payment',
  'settlement:read': 'View carrier settlements',
  'settlement:manage': 'Create and issue carrier settlements',
  'factoring:read': 'View factoring records',
  'factoring:manage': 'Manage factoring companies and assignments',

  /* ── Reporting ──────────────────────────────────────────────────────── */
  'report:read': 'View reports and dashboards',
  'report:export': 'Export a report',

  /* ── Audit, retention, leads ────────────────────────────────────────── */
  'audit:read': 'View the audit trail',
  'retention:manage': 'Run retention and archival actions',
  'legalhold:manage': 'Apply and release legal holds',
  'lead:read': 'View marketing leads and quote requests',
  'lead:update': 'Update lead status and assignment',
} as const

export type PermissionKey = keyof typeof PERMISSIONS

type Matrix = Partial<Record<PermissionKey, Scope>>

/* ── Role matrices ─────────────────────────────────────────────────────── */

const platformSuperAdmin: Matrix = {
  'platform:tenant:read': 'platform',
  'platform:tenant:create': 'platform',
  'platform:tenant:suspend': 'platform',
  'platform:tenant:support_access': 'platform',
  'platform:plan:read': 'platform',
  'platform:plan:manage': 'platform',
  'platform:health:read': 'platform',
  'platform:impersonate': 'platform',
  'tenant:billing:read': 'platform',
  'tenant:billing:update': 'platform',
  'audit:read': 'platform',
  // Deliberately narrow: tenant operational data requires an explicit support
  // session (platform:tenant:support_access), which grants a scoped Actor.
}

const admin: Matrix = {
  'tenant:settings:read': 'tenant',
  'tenant:settings:update': 'tenant',
  'tenant:user:read': 'tenant',
  'tenant:user:invite': 'tenant',
  'tenant:user:update': 'tenant',
  'tenant:user:suspend': 'tenant',
  'tenant:impersonate': 'tenant',
  'tenant:integration:read': 'tenant',
  'tenant:integration:update': 'tenant',
  'tenant:billing:read': 'tenant',
  'tenant:billing:update': 'tenant',

  'assignment:read': 'tenant',
  'assignment:manage': 'tenant',
  'assignment:commission:update': 'tenant',

  'carrier:read': 'tenant',
  'carrier:create': 'tenant',
  'carrier:update': 'tenant',
  'carrier:delete': 'tenant',
  'carrier:fee:update': 'tenant',
  'carrier:onboarding:read': 'tenant',
  'carrier:onboarding:submit': 'tenant',
  'carrier:onboarding:review': 'tenant',
  'carrier:onboarding:approve': 'tenant',
  'carrier:verification:read': 'tenant',
  'carrier:verification:run': 'tenant',
  'carrier:verification:override': 'tenant',

  'document:read': 'tenant',
  'document:download': 'tenant',
  'document:upload': 'tenant',
  'document:review': 'tenant',
  'document:delete': 'tenant',

  'signature:template:read': 'tenant',
  'signature:template:manage': 'tenant',
  'signature:request:create': 'tenant',
  'signature:request:read': 'tenant',
  'signature:void': 'tenant',
  'signature:certificate:download': 'tenant',

  'equipment:read': 'tenant',
  'equipment:create': 'tenant',
  'equipment:update': 'tenant',
  'equipment:status:update': 'tenant',
  'equipment:verification:override': 'tenant',
  'equipment:type:manage': 'tenant',
  'equipment:media:upload': 'tenant',

  'driver:read': 'tenant',
  'driver:create': 'tenant',
  'driver:update': 'tenant',
  'driver:approve': 'tenant',

  'customer:read': 'tenant',
  'customer:create': 'tenant',
  'customer:update': 'tenant',
  'customer:duplicate:override': 'tenant',
  'customer:delete': 'tenant',

  'load:read': 'tenant',
  'load:create': 'tenant',
  'load:update': 'tenant',
  'load:status:update': 'tenant',
  'load:cancel': 'tenant',
  'load:duplicate': 'tenant',
  'load:assign_resources': 'tenant',
  'load:assign_carrier': 'tenant',
  'load:financials:read': 'tenant',
  'load:financials:update': 'tenant',
  'load:document:upload': 'tenant',

  'route:calculate': 'tenant',
  'oversize:evaluate': 'tenant',
  'oversize:validate': 'tenant',
  'oversize:rule:manage': 'tenant',
  'permit:read': 'tenant',
  'permit:manage': 'tenant',
  'permit:approve_ready': 'tenant',

  'tracking:read': 'tenant',
  'tracking:manage': 'tenant',
  'tracking:link:create': 'tenant',
  'tracking:link:revoke': 'tenant',

  'message:read': 'tenant',
  'message:send': 'tenant',
  'message:template:manage': 'tenant',
  'notification:preference:update': 'own',

  'expense:read': 'tenant',
  'expense:submit': 'tenant',
  'expense:approve': 'tenant',
  'expense:category:manage': 'tenant',
  'finance:read': 'tenant',
  'finance:update': 'tenant',
  'invoice:read': 'tenant',
  'invoice:create': 'tenant',
  'invoice:send': 'tenant',
  'invoice:status:update': 'tenant',
  'payment:record': 'tenant',
  'payment:refund': 'tenant',
  'settlement:read': 'tenant',
  'settlement:manage': 'tenant',
  'factoring:read': 'tenant',
  'factoring:manage': 'tenant',

  'report:read': 'tenant',
  'report:export': 'tenant',
  'audit:read': 'tenant',
  'retention:manage': 'tenant',
  'legalhold:manage': 'tenant',
  'lead:read': 'tenant',
  'lead:update': 'tenant',
}

/**
 * Accounting is read-only across operations and read-write across money.
 * The absence of load:create / load:update / load:assign_* is the enforcement
 * of "cannot create or modify operational loads".
 */
const accounting: Matrix = {
  'tenant:settings:read': 'tenant',
  'tenant:user:read': 'tenant',
  'tenant:billing:read': 'tenant',
  'tenant:billing:update': 'tenant',

  'assignment:read': 'tenant',

  'carrier:read': 'tenant',
  'carrier:onboarding:read': 'tenant',
  'carrier:onboarding:review': 'tenant',
  'carrier:onboarding:approve': 'tenant',
  'carrier:verification:read': 'tenant',
  'carrier:verification:override': 'tenant',

  'document:read': 'tenant',
  'document:download': 'tenant',
  'document:upload': 'tenant',
  'document:review': 'tenant',

  'signature:template:read': 'tenant',
  'signature:request:read': 'tenant',
  'signature:request:create': 'tenant',
  'signature:certificate:download': 'tenant',

  'equipment:read': 'tenant',
  'equipment:verification:override': 'tenant',
  'driver:read': 'tenant',
  'driver:approve': 'tenant',
  'customer:read': 'tenant',

  'load:read': 'tenant',
  'load:financials:read': 'tenant',
  'load:financials:update': 'tenant',

  'permit:read': 'tenant',
  'tracking:read': 'tenant',

  'message:read': 'tenant',
  'message:send': 'tenant',
  'notification:preference:update': 'own',

  'expense:read': 'tenant',
  'expense:submit': 'tenant',
  'expense:approve': 'tenant',
  'expense:category:manage': 'tenant',
  'finance:read': 'tenant',
  'finance:update': 'tenant',
  'invoice:read': 'tenant',
  'invoice:create': 'tenant',
  'invoice:send': 'tenant',
  'invoice:status:update': 'tenant',
  'payment:record': 'tenant',
  'payment:refund': 'tenant',
  'settlement:read': 'tenant',
  'settlement:manage': 'tenant',
  'factoring:read': 'tenant',
  'factoring:manage': 'tenant',

  'report:read': 'tenant',
  'report:export': 'tenant',
  'audit:read': 'tenant',
}

/**
 * Dispatcher sees only what is assigned. Note `load:assign_resources` is absent:
 * it is granted at runtime only when the tenant setting
 * `allowDispatcherResourceAssignment` is true (see `resolveDispatcherMatrix`).
 */
const dispatcher: Matrix = {
  'tenant:settings:read': 'tenant',

  'assignment:read': 'own',

  'carrier:read': 'assigned',
  'carrier:update': 'assigned',
  'carrier:onboarding:read': 'assigned',
  'carrier:onboarding:submit': 'assigned',
  'carrier:verification:read': 'assigned',
  'carrier:verification:run': 'assigned',

  'document:read': 'assigned',
  'document:download': 'assigned',
  'document:upload': 'assigned',

  'signature:request:read': 'assigned',
  'signature:request:create': 'assigned',

  'equipment:read': 'assigned',
  'equipment:create': 'assigned',
  'equipment:update': 'assigned',
  'equipment:media:upload': 'assigned',

  'driver:read': 'assigned',
  'driver:create': 'assigned',
  'driver:update': 'assigned',
  'driver:approve': 'assigned',

  'customer:read': 'tenant',
  'customer:create': 'tenant',
  'customer:update': 'tenant',

  'load:read': 'assigned',
  'load:create': 'tenant',
  'load:update': 'assigned',
  'load:status:update': 'assigned',
  'load:cancel': 'assigned',
  'load:duplicate': 'assigned',
  'load:financials:read': 'assigned',
  'load:document:upload': 'assigned',

  'route:calculate': 'assigned',
  'oversize:evaluate': 'assigned',
  'permit:read': 'assigned',
  'permit:manage': 'assigned',

  'tracking:read': 'assigned',
  'tracking:manage': 'assigned',
  'tracking:link:create': 'assigned',
  'tracking:link:revoke': 'assigned',

  'message:read': 'assigned',
  'message:send': 'assigned',
  'notification:preference:update': 'own',

  'expense:read': 'assigned',
  'expense:submit': 'assigned',

  'report:read': 'assigned',
  'report:export': 'assigned',
}

const carrier: Matrix = {
  'carrier:read': 'carrier',
  'carrier:update': 'carrier',
  'carrier:onboarding:read': 'carrier',
  'carrier:onboarding:submit': 'carrier',
  'carrier:verification:read': 'carrier',

  'tenant:user:read': 'carrier',
  'tenant:user:invite': 'carrier',

  'document:read': 'carrier',
  'document:download': 'carrier',
  'document:upload': 'carrier',

  'signature:request:read': 'carrier',
  'signature:sign': 'own',
  'signature:certificate:download': 'carrier',

  'equipment:read': 'carrier',
  'equipment:create': 'carrier',
  'equipment:update': 'carrier',
  'equipment:media:upload': 'carrier',

  'driver:read': 'carrier',
  'driver:create': 'carrier',
  'driver:update': 'carrier',
  'driver:approve': 'carrier',

  'load:read': 'carrier',
  'load:financials:read': 'carrier',
  'load:rateconf:respond': 'carrier',
  'load:document:upload': 'carrier',

  'permit:read': 'carrier',
  'tracking:read': 'carrier',

  'message:read': 'carrier',
  'message:send': 'carrier',
  'notification:preference:update': 'own',

  'expense:read': 'carrier',
  'expense:submit': 'carrier',
  'invoice:read': 'carrier',
  'invoice:pay': 'carrier',
  'settlement:read': 'carrier',
  'factoring:read': 'carrier',
  'report:read': 'carrier',
}

/** Drivers never change load status directly — the permission is simply absent. */
const driver: Matrix = {
  'load:read': 'own',
  'load:document:upload': 'own',
  'driver:self:update': 'own',
  'driver:read': 'own',
  'equipment:read': 'own',
  'document:read': 'own',
  'document:download': 'own',
  'document:upload': 'own',
  'message:read': 'own',
  'message:send': 'own',
  'notification:preference:update': 'own',
  'tracking:consent': 'own',
  'tracking:read': 'own',
  'expense:submit': 'own',
  'permit:read': 'own',
}

export const ROLE_MATRIX: Record<Role, Matrix> = {
  platform_super_admin: platformSuperAdmin,
  admin,
  accounting,
  dispatcher,
  carrier,
  driver,
}

/**
 * Tenant-configurable grants. Keeping this as an explicit function rather than a
 * scattering of `if (settings.x)` checks means the exception is visible in one
 * place and testable in isolation.
 */
export function resolveRoleMatrix(
  role: Role,
  settings: { allowDispatcherResourceAssignment?: boolean } | null,
): Matrix {
  if (role !== 'dispatcher') return ROLE_MATRIX[role]
  if (!settings?.allowDispatcherResourceAssignment) return ROLE_MATRIX.dispatcher
  return { ...ROLE_MATRIX.dispatcher, 'load:assign_resources': 'assigned' }
}

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[]

export function permissionParts(key: PermissionKey): { resource: string; action: string } {
  const segments = key.split(':')
  return { resource: segments[0]!, action: segments.slice(1).join(':') }
}
