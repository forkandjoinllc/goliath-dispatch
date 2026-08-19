import 'server-only'
import { desc, eq, inArray } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  drivers,
  loads,
  trackingEvents,
  type Driver,
  type Load,
  type TrackingEvent,
  type TrackingSession,
} from '@/db/schema'
import { fullName } from '@/lib/utils'
import type { ScopeFilter } from '@/lib/permissions'
import { listActiveSessions } from './sessions'

/**
 * Read models for the tracking screens. These join across `loads`/`drivers`
 * purely for display — every write path stays in `sessions.ts`/`ingest.ts`.
 */

export interface FleetSessionRow {
  session: TrackingSession
  load: Load
  driverName: string | null
}

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
    case 'own':
      return false
    default:
      return false
  }
}

function sessionInOwnScope(session: TrackingSession, driverById: Map<string, Driver>, scope: ScopeFilter): boolean {
  if (scope.kind !== 'own') return true
  const driver = session.driverId ? driverById.get(session.driverId) : null
  return Boolean(driver && scope.driverId === driver.id)
}

/** Every currently-open tracking session across the fleet, scoped to what the actor may see. */
export async function listFleetTrackingSessions(db: TenantDb, scope: ScopeFilter): Promise<FleetSessionRow[]> {
  const sessions = await listActiveSessions(db)
  if (sessions.length === 0) return []

  const loadIds = [...new Set(sessions.map((s) => s.loadId))]
  const driverIds = [...new Set(sessions.map((s) => s.driverId).filter((v): v is string => Boolean(v)))]

  const [loadRows, driverRows] = await Promise.all([
    db.findMany(loads, { where: inArray(loads.id, loadIds) }),
    driverIds.length > 0 ? db.findMany(drivers, { where: inArray(drivers.id, driverIds) }) : Promise.resolve([]),
  ])
  const loadById = new Map(loadRows.map((l) => [l.id, l]))
  const driverById = new Map(driverRows.map((d) => [d.id, d]))

  const rows: FleetSessionRow[] = []
  for (const session of sessions) {
    const load = loadById.get(session.loadId)
    if (!load) continue
    if (scope.kind === 'own') {
      if (!sessionInOwnScope(session, driverById, scope)) continue
    } else if (!loadInScope(load, scope)) {
      continue
    }
    const driver = session.driverId ? driverById.get(session.driverId) : null
    rows.push({ session, load, driverName: driver ? fullName(driver) : null })
  }

  return rows.sort((a, b) => (b.session.startedAt?.getTime() ?? 0) - (a.session.startedAt?.getTime() ?? 0))
}

export interface SessionEventsResult {
  session: TrackingSession
  events: TrackingEvent[]
}

/** Full event timeline for one session — newest first, for the load detail timeline. */
export async function listSessionEvents(db: TenantDb, sessionId: string, limit = 200): Promise<TrackingEvent[]> {
  return db.findMany(trackingEvents, {
    where: eq(trackingEvents.sessionId, sessionId),
    orderBy: desc(trackingEvents.occurredAt),
    limit,
  })
}
