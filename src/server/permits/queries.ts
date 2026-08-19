import 'server-only'
import { inArray } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { escorts, loads, permits, type Escort, type Load, type Permit } from '@/db/schema'
import type { ScopeFilter } from '@/lib/permissions'
import { listExpiringPermits } from './service'

/**
 * Read models joining permits/escorts to their load for the permits screen —
 * mirrors `tracking/queries.ts`'s scoping approach so a carrier or assigned
 * dispatcher only ever sees rows for loads they may see. `TenantDb` already
 * confines every query to the tenant; this layer narrows further to the
 * actor's own scope within it.
 */

function loadInScope(load: Load, scope: ScopeFilter): boolean {
  switch (scope.kind) {
    case 'platform':
    case 'tenant':
      return true
    case 'carrier':
      return Boolean(scope.carrierId) && load.carrierId === scope.carrierId
    case 'assigned':
      return (
        (load.carrierId != null && scope.carrierIds.includes(load.carrierId)) ||
        scope.dispatcherUserId === load.dispatcherUserId
      )
    default:
      return false
  }
}

export interface PermitRow {
  permit: Permit
  load: Load
}

export interface EscortRow {
  escort: Escort
  load: Load
}

async function loadsById(db: TenantDb, loadIds: string[]): Promise<Map<string, Load>> {
  if (loadIds.length === 0) return new Map()
  const rows = await db.findMany(loads, { where: inArray(loads.id, loadIds) })
  return new Map(rows.map((l) => [l.id, l]))
}

/** Every permit across the tenant's loads, scoped to what the actor may see. */
export async function listAllPermits(db: TenantDb, scope: ScopeFilter): Promise<PermitRow[]> {
  const permitRows = await db.findMany(permits)
  if (permitRows.length === 0) return []
  const byLoad = await loadsById(db, [...new Set(permitRows.map((p) => p.loadId))])
  const rows: PermitRow[] = []
  for (const permit of permitRows) {
    const load = byLoad.get(permit.loadId)
    if (!load || !loadInScope(load, scope)) continue
    rows.push({ permit, load })
  }
  return rows
}

/** Every escort across the tenant's loads, scoped to what the actor may see. */
export async function listAllEscorts(db: TenantDb, scope: ScopeFilter): Promise<EscortRow[]> {
  const escortRows = await db.findMany(escorts)
  if (escortRows.length === 0) return []
  const byLoad = await loadsById(db, [...new Set(escortRows.map((e) => e.loadId))])
  const rows: EscortRow[] = []
  for (const escort of escortRows) {
    const load = byLoad.get(escort.loadId)
    if (!load || !loadInScope(load, scope)) continue
    rows.push({ escort, load })
  }
  return rows
}

/** Permits expiring soon, scoped, with their load attached for display. */
export async function listExpiringPermitsScoped(
  db: TenantDb,
  scope: ScopeFilter,
  withinDays: number,
): Promise<PermitRow[]> {
  const expiring = await listExpiringPermits(db, withinDays)
  if (expiring.length === 0) return []
  const byLoad = await loadsById(db, [...new Set(expiring.map((p) => p.loadId))])
  const rows: PermitRow[] = []
  for (const permit of expiring) {
    const load = byLoad.get(permit.loadId)
    if (!load || !loadInScope(load, scope)) continue
    rows.push({ permit, load })
  }
  return rows
}
