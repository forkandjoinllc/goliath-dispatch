import 'server-only'
import { createHash } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { loadStops, routes, routeStates, type LoadStop, type Route, type RouteState } from '@/db/schema'
import { isAppError, validationFailed } from '@/lib/errors'
import {
  getGeoProvider,
  getTollProvider,
  statesBetween,
  type RouteWaypoint,
  type StateCode,
} from '@/integrations/geo'

/**
 * Route calculation.
 *
 * A route is recomputed only when the ordered set of stop coordinates has
 * actually changed (`stopsFingerprint`), unless the caller passes
 * `force: true` — the geo provider is billable in production, so an
 * unchanged load must never re-bill it. Every prior `routes` row for the
 * load is marked `isCurrent: false` in the same transaction that inserts the
 * new one, so `currentRoute` is always a single, unambiguous answer.
 */

export interface RouteWithStates {
  route: Route
  states: RouteState[]
}

export interface CalculateRouteOptions {
  /** Bypasses the fingerprint cache and recalculates unconditionally. */
  force?: boolean
}

/**
 * TollGuru is deliberately unimplemented this release (see
 * `src/integrations/geo/tollguru-adapter.ts`). `routes.estimatedTollCents` is
 * `null` whenever no toll provider is configured, and this is the one
 * documented reason key the UI shows instead of a fabricated number.
 */
export const TOLL_UNAVAILABLE_REASON_KEY = 'tracking.errors.routeTollNotConfigured'

function stopsFingerprint(waypoints: RouteWaypoint[]): string {
  const key = waypoints.map((w) => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`).join('|')
  return createHash('sha256').update(key).digest('hex')
}

interface OrderedStopsResult {
  stops: LoadStop[]
  waypoints: RouteWaypoint[]
}

async function orderedStopsAndWaypoints(db: TenantDb, loadId: string): Promise<OrderedStopsResult> {
  const stops = await db.findMany(loadStops, {
    where: eq(loadStops.loadId, loadId),
    orderBy: asc(loadStops.sequence),
  })
  if (stops.length < 2) {
    throw validationFailed('tracking.errors.routeNeedsTwoStops')
  }

  const waypoints: RouteWaypoint[] = stops.map((stop) => {
    if (stop.latitude == null || stop.longitude == null) {
      throw validationFailed('tracking.errors.routeStopMissingCoordinates', {
        stopId: stop.id,
        city: stop.city ?? '',
      })
    }
    return {
      lat: Number(stop.latitude),
      lng: Number(stop.longitude),
      label: stop.facilityName ?? stop.city ?? undefined,
    }
  })

  return { stops, waypoints }
}

/** The load's current (`isCurrent: true`) route, or null when none has been calculated yet. */
export async function currentRoute(db: TenantDb, loadId: string): Promise<RouteWithStates | null> {
  const route = await db.findFirst(routes, {
    where: and(eq(routes.loadId, loadId), eq(routes.isCurrent, true))!,
    orderBy: desc(routes.calculatedAt),
  })
  if (!route) return null

  const states = await db.findMany(routeStates, {
    where: eq(routeStates.routeId, route.id),
    orderBy: asc(routeStates.sequence),
  })
  return { route, states }
}

/**
 * A best-effort per-leg state list, derived from the stops' own `state`
 * column via `statesBetween`'s adjacency fallback — the geo provider's
 * `RouteLeg` carries no per-leg state breakdown, only the route-wide
 * deduplicated list (`RouteResult.states`), which is what actually backs
 * `route_states`. This is only used to enrich the `legs` JSON for display;
 * it is explicitly a topological approximation, never a geometry fact.
 */
function approximateLegStates(from: LoadStop, to: LoadStop): string[] {
  const fromState = from.state as StateCode | null
  const toState = to.state as StateCode | null
  if (!fromState || !toState) return []
  try {
    return statesBetween(fromState, toState)
  } catch {
    return []
  }
}

export async function calculateRoute(
  db: TenantDb,
  loadId: string,
  options: CalculateRouteOptions = {},
): Promise<RouteWithStates> {
  const { stops, waypoints } = await orderedStopsAndWaypoints(db, loadId)
  const fingerprint = stopsFingerprint(waypoints)

  if (!options.force) {
    const existing = await currentRoute(db, loadId)
    if (existing && existing.route.rawReference === fingerprint) {
      return existing
    }
  }

  const geo = getGeoProvider()
  const result = await geo.route({ waypoints })

  // Never fabricate a toll figure — a configured provider fails loudly
  // (integration_unavailable), an unconfigured one (this release, always)
  // leaves the estimate null with a documented reason.
  let tollCents: number | null = null
  try {
    tollCents = await getTollProvider().estimateTollCents({ waypoints })
  } catch (error) {
    if (!isAppError(error) || error.code !== 'integration_unavailable') throw error
    tollCents = null
  }

  return db.transaction(async (tx) => {
    await tx.updateWhere(routes, and(eq(routes.loadId, loadId), eq(routes.isCurrent, true))!, {
      isCurrent: false,
    })

    const created = await tx.insert(routes, {
      loadId,
      provider: geo.name,
      totalMiles: Math.round(result.totalMiles),
      estimatedDurationMinutes: Math.round(result.durationMinutes),
      estimatedTollCents: tollCents,
      polyline: result.polyline,
      legs: result.legs.map((leg) => ({
        fromStopId: stops[leg.fromIndex]?.id ?? '',
        toStopId: stops[leg.toIndex]?.id ?? '',
        miles: leg.miles,
        durationMinutes: leg.durationMinutes,
        states: approximateLegStates(stops[leg.fromIndex]!, stops[leg.toIndex]!),
      })),
      rawReference: fingerprint,
      calculatedAt: new Date(),
      isCurrent: true,
    })

    const states =
      result.states.length > 0
        ? await tx.insertMany(
            routeStates,
            result.states.map((stateCode, index) => ({
              routeId: created.id,
              stateCode,
              sequence: index,
              milesInState: null,
            })),
          )
        : []

    return { route: created, states }
  })
}

/**
 * Convenience for callers (oversize evaluation, tracking session start) that
 * need a route and are happy to compute one on demand rather than treating
 * its absence as an error. Returns `null` only when the load's stops cannot
 * be routed at all (fewer than two stops, or missing coordinates) — that
 * failure is swallowed here and surfaced as a `missingDataWarnings` entry by
 * the caller, never as a thrown error interrupting an unrelated flow.
 */
export async function currentOrCalculateRoute(db: TenantDb, loadId: string): Promise<RouteWithStates | null> {
  const existing = await currentRoute(db, loadId)
  if (existing) return existing
  try {
    return await calculateRoute(db, loadId)
  } catch (error) {
    if (isAppError(error) && (error.code === 'validation_failed' || error.code === 'integration_unavailable')) {
      return null
    }
    throw error
  }
}
