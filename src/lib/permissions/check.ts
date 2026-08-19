import { forbidden, unauthenticated } from '../errors'
import { resolveRoleMatrix, type PermissionKey } from './catalog'
import { SCOPE_RANK, type Actor, type Decision, type ResourceContext, type Scope } from './types'

/**
 * The one place authorization is decided.
 *
 * `can()` answers yes/no and at what scope; `authorize()` throws an AppError.
 * Both are pure functions of the Actor — no database access — so they are cheap
 * enough to call in render paths and trivially testable.
 */

export interface TenantPolicy {
  allowDispatcherResourceAssignment?: boolean
}

export function can(
  actor: Actor | null,
  permission: PermissionKey,
  resource?: ResourceContext,
  policy?: TenantPolicy | null,
): Decision {
  if (!actor) return { allowed: false, scope: null, reasonKey: 'errors.unauthenticated' }

  // A denial override beats everything, including a platform super admin grant.
  const denial = actor.overrides.find((o) => o.permissionKey === permission && o.effect === 'deny')
  if (denial) return { allowed: false, scope: null, reasonKey: 'errors.permissionDenied' }

  if (actor.mfaRequired && !actor.mfaSatisfied) {
    return { allowed: false, scope: null, reasonKey: 'errors.mfaRequired' }
  }

  const grants: Scope[] = []

  if (actor.role) {
    const matrix = resolveRoleMatrix(actor.role, policy ?? null)
    const roleScope = matrix[permission]
    if (roleScope) grants.push(roleScope)
  }

  const override = actor.overrides.find(
    (o) => o.permissionKey === permission && o.effect === 'grant',
  )
  if (override) grants.push(override.scope)

  if (grants.length === 0) {
    return { allowed: false, scope: null, reasonKey: 'errors.permissionDenied' }
  }

  // Widest grant wins; the resource check then narrows it.
  const scope = grants.sort((a, b) => SCOPE_RANK[b] - SCOPE_RANK[a])[0]!

  if (!resource) return { allowed: true, scope }

  return resourceInScope(actor, scope, resource)
    ? { allowed: true, scope }
    : { allowed: false, scope, reasonKey: 'errors.outOfScope' }
}

/** Evaluates whether a specific record falls inside the granted scope. */
export function resourceInScope(
  actor: Actor,
  scope: Scope,
  resource: ResourceContext,
): boolean {
  if (scope === 'platform') return true

  // Every non-platform scope is first and foremost a tenant boundary.
  if (resource.tenantId != null && resource.tenantId !== actor.tenantId) return false

  switch (scope) {
    case 'tenant':
      return actor.tenantId != null

    case 'assigned': {
      const { assignments } = actor
      if (resource.carrierId && assignments.carrierIds.includes(resource.carrierId)) return true
      if (resource.dispatcherUserId && resource.dispatcherUserId === actor.userId) return true
      if (resource.truckId && assignments.truckIds.includes(resource.truckId)) return true
      if (resource.trailerId && assignments.trailerIds.includes(resource.trailerId)) return true
      if (resource.driverId && assignments.driverIds.includes(resource.driverId)) return true
      if (resource.groupId && assignments.groupIds.includes(resource.groupId)) return true
      // A resource with no scoping facts at all cannot be proven in-scope.
      return false
    }

    case 'carrier':
      return actor.carrierId != null && resource.carrierId === actor.carrierId

    case 'own': {
      if (resource.ownerUserId && resource.ownerUserId === actor.userId) return true
      if (resource.driverId && actor.driverId && resource.driverId === actor.driverId) return true
      if (resource.dispatcherUserId && resource.dispatcherUserId === actor.userId) return true
      return false
    }

    default:
      return false
  }
}

/** Throws AppError('forbidden') unless the actor may perform the action. */
export function authorize(
  actor: Actor | null,
  permission: PermissionKey,
  resource?: ResourceContext,
  policy?: TenantPolicy | null,
): Scope {
  const decision = can(actor, permission, resource, policy)
  if (decision.allowed && decision.scope) return decision.scope
  if (!actor) throw unauthenticated()
  throw forbidden(decision.reasonKey ?? 'errors.permissionDenied', { permission })
}

/** True when the actor holds the permission at any scope (menu visibility). */
export function canAny(
  actor: Actor | null,
  permissions: PermissionKey[],
  policy?: TenantPolicy | null,
): boolean {
  return permissions.some((p) => can(actor, p, undefined, policy).allowed)
}

/**
 * Convenience for list queries: returns the narrowing predicate facts the data
 * layer should apply, so a dispatcher's index page cannot even fetch rows it
 * may not see.
 */
export function scopeFilter(actor: Actor, scope: Scope) {
  switch (scope) {
    case 'platform':
      return { kind: 'platform' as const }
    case 'tenant':
      return { kind: 'tenant' as const, tenantId: actor.tenantId! }
    case 'assigned':
      return {
        kind: 'assigned' as const,
        tenantId: actor.tenantId!,
        carrierIds: actor.assignments.carrierIds,
        truckIds: actor.assignments.truckIds,
        trailerIds: actor.assignments.trailerIds,
        driverIds: actor.assignments.driverIds,
        dispatcherUserId: actor.userId,
      }
    case 'carrier':
      return { kind: 'carrier' as const, tenantId: actor.tenantId!, carrierId: actor.carrierId! }
    case 'own':
      return {
        kind: 'own' as const,
        tenantId: actor.tenantId!,
        userId: actor.userId,
        driverId: actor.driverId,
      }
  }
}

export type ScopeFilter = ReturnType<typeof scopeFilter>
