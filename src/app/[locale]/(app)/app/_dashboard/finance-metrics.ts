import 'server-only'
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { carrierSettlements, financialSnapshots, loads } from '@/db/schema'
import type { TenantDb } from '@/db/tenant-db'
import { receivablesAgingSummary } from '@/server/invoices/queries'
import type { ScopeFilter } from '@/lib/permissions/check'
import { loadsScope } from '@/server/reports/scope'

/**
 * Shared dashboard finance metrics — loads, receivables, settlements and
 * gross margin, each honoring the same actor scope the reports module
 * enforces. Reuses `receivablesAgingSummary()` from `@/server/invoices`
 * rather than re-deriving aging logic, and mirrors (at a summary level, not
 * a full breakdown) the same "latest snapshot per load" aggregation
 * `revenue-margin.ts` uses so the dashboard number and the report agree.
 */

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export async function activeLoadCount(db: TenantDb, scope: ScopeFilter): Promise<number> {
  const scoped = loadsScope(scope, { carrierId: loads.carrierId, dispatcherUserId: loads.dispatcherUserId })
  if (scoped === 'empty') return 0
  const clauses = [
    inArray(loads.status, ['available', 'assigned', 'dispatched', 'en_route_to_pickup', 'at_pickup', 'in_transit', 'at_delivery']),
  ]
  if (scoped) clauses.push(scoped)
  return db.count(loads, and(...clauses))
}

export async function openReceivablesCents(db: TenantDb, scope: ScopeFilter, asOf: Date = new Date()): Promise<number> {
  const summary = await receivablesAgingSummary(db, scope, asOf)
  return Object.values(summary).reduce((sum, cents) => sum + cents, 0)
}

/** Sum of `net_amount_cents` for settlements issued but not yet paid. */
export async function pendingSettlementPayoutCents(db: TenantDb, scope: ScopeFilter): Promise<number> {
  const clauses = [eq(carrierSettlements.status, 'issued')]
  if (scope.kind === 'carrier') {
    clauses.push(eq(carrierSettlements.carrierId, scope.carrierId))
  } else if (scope.kind === 'assigned') {
    if (scope.carrierIds.length === 0) return 0
    clauses.push(inArray(carrierSettlements.carrierId, scope.carrierIds))
  } else if (scope.kind !== 'tenant' && scope.kind !== 'platform') {
    return 0
  }

  const rows = await db.findMany(carrierSettlements, { where: and(...clauses) })
  return rows.reduce((sum, row) => sum + row.netAmountCents, 0)
}

/** Tenant-wide (or carrier-scope-narrowed) gross margin for loads delivered so far this month. */
export async function monthToDateGrossMarginCents(db: TenantDb, scope: ScopeFilter, now: Date = new Date()): Promise<number | null> {
  // Structural: a carrier never sees tenant margin.
  if (scope.kind === 'carrier') return null

  const scoped = loadsScope(scope, { carrierId: loads.carrierId, dispatcherUserId: loads.dispatcherUserId })
  if (scoped === 'empty') return 0

  const clauses = [isNotNull(loads.actualDeliveryAt), gte(loads.actualDeliveryAt, startOfMonth(now)), lte(loads.actualDeliveryAt, now)]
  if (scoped) clauses.push(scoped)

  const matchingLoads = await db.findMany(loads, { where: and(...clauses) })
  if (matchingLoads.length === 0) return 0

  const loadIds = matchingLoads.map((l) => l.id)
  const snapshots = await db.findMany(financialSnapshots, { where: inArray(financialSnapshots.loadId, loadIds) })
  const latestByLoad = new Map<string, (typeof snapshots)[number]>()
  for (const snap of snapshots) {
    const current = latestByLoad.get(snap.loadId)
    if (!current || snap.version > current.version) latestByLoad.set(snap.loadId, snap)
  }

  let total = 0
  for (const snapshot of latestByLoad.values()) total += snapshot.grossMarginCents
  return total
}
