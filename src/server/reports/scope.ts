import 'server-only'
import { and, eq, inArray, or, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { ScopeFilter } from '@/lib/permissions/check'

/**
 * Row-level scope predicates shared by every report.
 *
 * Mirrors the `*ScopeClause` helpers already private to `invoices/queries.ts`
 * and `settlements/queries.ts` — duplicated here (not imported, they are not
 * exported) rather than modifying files this agent does not own. `'empty'`
 * means the scope can never match any row for this table, so the caller
 * should short-circuit to an empty result rather than run the query.
 */
export type ScopeClause = SQL | 'empty' | undefined

/** Scope predicate for any table with a nullable `carrier_id` column (loads, permits…). */
export function carrierColumnScope(scope: ScopeFilter, carrierIdColumn: PgColumn): ScopeClause {
  switch (scope.kind) {
    case 'carrier':
      return eq(carrierIdColumn, scope.carrierId)
    case 'assigned':
      return scope.carrierIds.length > 0 ? inArray(carrierIdColumn, scope.carrierIds) : 'empty'
    case 'own':
      return 'empty'
    case 'tenant':
    case 'platform':
    default:
      return undefined
  }
}

/**
 * Scope for the `loads` table specifically: a Dispatcher's "assigned" reach
 * includes both their assigned carriers and any load they personally
 * dispatch (a load with no carrier yet, e.g. `available`).
 */
export function loadsScope(
  scope: ScopeFilter,
  columns: { carrierId: PgColumn; dispatcherUserId: PgColumn },
): ScopeClause {
  switch (scope.kind) {
    case 'carrier':
      return eq(columns.carrierId, scope.carrierId)
    case 'assigned': {
      const clauses: SQL[] = []
      if (scope.carrierIds.length > 0) clauses.push(inArray(columns.carrierId, scope.carrierIds))
      if (scope.dispatcherUserId) clauses.push(eq(columns.dispatcherUserId, scope.dispatcherUserId))
      if (clauses.length === 0) return 'empty'
      return or(...clauses)
    }
    case 'own':
      return 'empty'
    case 'tenant':
    case 'platform':
    default:
      return undefined
  }
}

/** Carrier-owned resource by direct `carrier_id`, restricted to a dispatcher's assigned resource ids. */
export function resourceScope(
  scope: ScopeFilter,
  carrierIdColumn: PgColumn,
  resourceIdColumn: PgColumn,
  assignedResourceIds: (scope: Extract<ScopeFilter, { kind: 'assigned' }>) => string[],
): ScopeClause {
  switch (scope.kind) {
    case 'carrier':
      return eq(carrierIdColumn, scope.carrierId)
    case 'assigned': {
      const ids = assignedResourceIds(scope)
      const clauses: SQL[] = []
      if (scope.carrierIds.length > 0) clauses.push(inArray(carrierIdColumn, scope.carrierIds))
      if (ids.length > 0) clauses.push(inArray(resourceIdColumn, ids))
      if (clauses.length === 0) return 'empty'
      return or(...clauses)
    }
    case 'own':
      return 'empty'
    case 'tenant':
    case 'platform':
    default:
      return undefined
  }
}

/** Dispatcher performance / commission reports: scoped to the dispatcher's own rows only. */
export function dispatcherColumnScope(scope: ScopeFilter, dispatcherUserIdColumn: PgColumn): ScopeClause {
  switch (scope.kind) {
    case 'assigned':
      return scope.dispatcherUserId ? eq(dispatcherUserIdColumn, scope.dispatcherUserId) : 'empty'
    case 'carrier':
    case 'own':
      return 'empty'
    case 'tenant':
    case 'platform':
    default:
      return undefined
  }
}

export function combine(...clauses: ScopeClause[]): SQL | 'empty' | undefined {
  if (clauses.some((c) => c === 'empty')) return 'empty'
  const defined = clauses.filter((c): c is SQL => c !== undefined && c !== 'empty')
  if (defined.length === 0) return undefined
  return and(...defined)
}
