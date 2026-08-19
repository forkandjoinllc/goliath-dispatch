/**
 * Authorization vocabulary.
 *
 * Nothing in the UI decides access. Components ask `can()`; server actions and
 * route handlers call `authorize()`, which throws. Role names appear in exactly
 * one place — the matrix in `catalog.ts`.
 */

export type Role =
  | 'platform_super_admin'
  | 'admin'
  | 'accounting'
  | 'dispatcher'
  | 'carrier'
  | 'driver'

/**
 * How wide a grant reaches:
 *  • platform — across every tenant (Super Admin only)
 *  • tenant   — every record inside the acting tenant
 *  • assigned — only records reachable through explicit assignment
 *  • carrier  — only records belonging to the actor's own carrier company
 *  • own      — only records the actor personally owns or created
 */
export type Scope = 'platform' | 'tenant' | 'assigned' | 'carrier' | 'own'

export const SCOPE_RANK: Record<Scope, number> = {
  own: 1,
  carrier: 2,
  assigned: 3,
  tenant: 4,
  platform: 5,
}

export interface AssignmentScope {
  /** Carriers the dispatcher is assigned to (any active assignment). */
  carrierIds: string[]
  /** Trucks/trailers/drivers explicitly granted, or reachable via owned groups. */
  truckIds: string[]
  trailerIds: string[]
  driverIds: string[]
  groupIds: string[]
}

export interface Impersonation {
  /** The Super Admin or Admin who initiated the session. */
  actorUserId: string
  impersonationSessionId: string
  reason: string
}

export interface Actor {
  userId: string
  email: string
  firstName: string
  lastName: string
  locale: 'en' | 'es'
  timezone: string
  isPlatformSuperAdmin: boolean

  /** Null only for platform-level contexts and public requests. */
  tenantId: string | null
  role: Role | null
  /** Set when role is `carrier` or `driver`. */
  carrierId: string | null
  driverId: string | null

  assignments: AssignmentScope
  /** Per-user grants and denials layered over the role matrix. */
  overrides: Array<{ permissionKey: string; effect: 'grant' | 'deny'; scope: Scope }>

  mfaRequired: boolean
  mfaSatisfied: boolean
  impersonation: Impersonation | null
  sessionId: string | null
}

/** Facts about the record being acted on, used to evaluate narrow scopes. */
export interface ResourceContext {
  tenantId?: string | null
  carrierId?: string | null
  dispatcherUserId?: string | null
  ownerUserId?: string | null
  driverId?: string | null
  truckId?: string | null
  trailerId?: string | null
  groupId?: string | null
}

export interface Decision {
  allowed: boolean
  scope: Scope | null
  /** i18n key explaining the refusal — surfaced on permission-denied screens. */
  reasonKey?: string
}
