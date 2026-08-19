import 'server-only'
import { and, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import type { Database as TenantQueryable } from '@/db/client'
import { carriers, customers, driverCarrierRelationships, drivers, invoices, loadAssignments, loads, trailers, trucks } from '@/db/schema'
import { can, type Actor, type PermissionKey, type Scope } from '@/lib/permissions'
import type {
  GlobalSearchGroupKey,
  GlobalSearchResultItem,
  GlobalSearchResults,
} from '@/components/shell/global-search'
import { normalizeVin } from '@/lib/utils'

/**
 * Global search.
 *
 * Structured as a registry of `SearchProvider`s — one per entity type — so a
 * later domain (loads, invoices, and anything after them) is one more entry,
 * not a change to the dispatch logic here. Every provider is doubly gated:
 *
 *  1. `can(actor, provider.permission)` — a role that lacks the permission at
 *     any scope never even runs the query.
 *  2. The scope `can()` returns is turned into a SQL predicate before the
 *     query runs — a dispatcher's `assigned` scope means the query itself
 *     only reads rows for carriers/resources they are assigned to, not "read
 *     everything and filter in memory".
 *
 * A resource type with no way to express a given scope (e.g. a truck has no
 * "own" concept) resolves to "no results" for that scope rather than a
 * best-effort guess.
 */

const RESULTS_PER_GROUP = 8
const MIN_QUERY_LENGTH = 2

export interface SearchProvider {
  key: GlobalSearchGroupKey
  permission: PermissionKey
  run(db: TenantQueryable, actor: Actor, scope: Scope, query: string): Promise<GlobalSearchResultItem[]>
}

function appHref(actor: Actor, path: string): string {
  return `/${actor.locale}/app${path}`
}

/** `null` means "this scope cannot be expressed for this table" — the caller returns no results. */
function idListOrNull(ids: string[]): string[] | null {
  return ids.length > 0 ? ids : null
}

/* ── Carriers ────────────────────────────────────────────────────────────── */

const carrierProvider: SearchProvider = {
  key: 'carriers',
  permission: 'carrier:read',
  async run(db, actor, scope, query) {
    const like = `%${query}%`
    const textMatch = or(
      ilike(carriers.legalName, like),
      ilike(carriers.dba, like),
      ilike(carriers.dotNumber, like),
      ilike(carriers.mcNumber, like),
    )

    let scopeCondition: SQL | undefined
    if (scope === 'assigned') {
      const ids = idListOrNull(actor.assignments.carrierIds)
      if (!ids) return []
      scopeCondition = inArray(carriers.id, ids)
    } else if (scope === 'carrier') {
      if (!actor.carrierId) return []
      scopeCondition = eq(carriers.id, actor.carrierId)
    } else if (scope === 'own') {
      return []
    }

    const rows = await db
      .select({ id: carriers.id, legalName: carriers.legalName, dotNumber: carriers.dotNumber })
      .from(carriers)
      .where(and(eq(carriers.tenantId, actor.tenantId!), isNull(carriers.deletedAt), textMatch, scopeCondition))
      .limit(RESULTS_PER_GROUP)

    return rows.map((r) => ({
      id: r.id,
      label: r.legalName,
      description: `DOT ${r.dotNumber}`,
      href: appHref(actor, `/carriers/${r.id}`),
    }))
  },
}

/* ── Customers (always tenant-wide when granted) ────────────────────────── */

const customerProvider: SearchProvider = {
  key: 'customers',
  permission: 'customer:read',
  async run(db, actor, scope, query) {
    if (scope === 'assigned' || scope === 'carrier' || scope === 'own') return []
    const like = `%${query}%`
    const phoneDigits = query.replace(/\D/g, '')
    const conditions = [
      ilike(customers.companyName, like),
      ilike(customers.dotNumber, like),
      ilike(customers.mcNumber, like),
    ]
    if (phoneDigits.length > 0) {
      conditions.push(ilike(customers.phoneNormalized, `%${phoneDigits}%`))
    }
    const textMatch = or(...conditions)

    const rows = await db
      .select({ id: customers.id, companyName: customers.companyName, phone: customers.phone })
      .from(customers)
      .where(and(eq(customers.tenantId, actor.tenantId!), isNull(customers.deletedAt), textMatch))
      .limit(RESULTS_PER_GROUP)

    return rows.map((r) => ({
      id: r.id,
      label: r.companyName,
      description: r.phone ?? undefined,
      href: appHref(actor, `/customers/${r.id}`),
    }))
  },
}

/* ── Drivers ─────────────────────────────────────────────────────────────── */

const driverProvider: SearchProvider = {
  key: 'drivers',
  permission: 'driver:read',
  async run(db, actor, scope, query) {
    const like = `%${query}%`
    const nameMatch = or(ilike(drivers.firstName, like), ilike(drivers.lastName, like))

    if (scope === 'tenant' || scope === 'platform') {
      const rows = await db
        .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
        .from(drivers)
        .where(and(eq(drivers.tenantId, actor.tenantId!), isNull(drivers.deletedAt), nameMatch))
        .limit(RESULTS_PER_GROUP)
      return rows.map(toDriverResult(actor))
    }

    if (scope === 'assigned') {
      const ids = idListOrNull(actor.assignments.driverIds)
      if (!ids) return []
      const rows = await db
        .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
        .from(drivers)
        .where(and(eq(drivers.tenantId, actor.tenantId!), isNull(drivers.deletedAt), nameMatch, inArray(drivers.id, ids)))
        .limit(RESULTS_PER_GROUP)
      return rows.map(toDriverResult(actor))
    }

    if (scope === 'carrier') {
      if (!actor.carrierId) return []
      const rows = await db
        .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
        .from(drivers)
        .innerJoin(driverCarrierRelationships, eq(driverCarrierRelationships.driverId, drivers.id))
        .where(
          and(
            eq(drivers.tenantId, actor.tenantId!),
            isNull(drivers.deletedAt),
            eq(driverCarrierRelationships.carrierId, actor.carrierId),
            isNull(driverCarrierRelationships.deletedAt),
            nameMatch,
          ),
        )
        .limit(RESULTS_PER_GROUP)
      return rows.map(toDriverResult(actor))
    }

    if (scope === 'own') {
      if (!actor.driverId) return []
      const rows = await db
        .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
        .from(drivers)
        .where(and(eq(drivers.id, actor.driverId), isNull(drivers.deletedAt), nameMatch))
        .limit(RESULTS_PER_GROUP)
      return rows.map(toDriverResult(actor))
    }

    return []
  },
}

function toDriverResult(actor: Actor) {
  return (r: { id: string; firstName: string; lastName: string }): GlobalSearchResultItem => ({
    id: r.id,
    label: `${r.firstName} ${r.lastName}`,
    href: appHref(actor, `/drivers/${r.id}`),
  })
}

/* ── Trucks / trailers ───────────────────────────────────────────────────── */

function equipmentProvider(key: 'trucks' | 'trailers'): SearchProvider {
  const table = key === 'trucks' ? trucks : trailers
  return {
    key,
    permission: 'equipment:read',
    async run(db, actor, scope, query) {
      const vinNormalized = normalizeVin(query)
      const like = `%${query}%`
      const textMatch = or(ilike(table.unitNumber, like), ilike(table.vinNormalized, `%${vinNormalized}%`))

      let scopeCondition: SQL | undefined
      if (scope === 'assigned') {
        const assignedIds = key === 'trucks' ? actor.assignments.truckIds : actor.assignments.trailerIds
        const carrierIds = actor.assignments.carrierIds
        if (assignedIds.length === 0 && carrierIds.length === 0) return []
        const clauses: SQL[] = []
        if (assignedIds.length > 0) clauses.push(inArray(table.id, assignedIds))
        if (carrierIds.length > 0) clauses.push(inArray(table.carrierId, carrierIds))
        scopeCondition = or(...clauses)
      } else if (scope === 'carrier') {
        if (!actor.carrierId) return []
        scopeCondition = eq(table.carrierId, actor.carrierId)
      } else if (scope === 'own') {
        return []
      }

      const rows = await db
        .select({ id: table.id, unitNumber: table.unitNumber, vin: table.vin })
        .from(table)
        .where(and(eq(table.tenantId, actor.tenantId!), isNull(table.deletedAt), textMatch, scopeCondition))
        .limit(RESULTS_PER_GROUP)

      return rows.map((r) => ({
        id: r.id,
        label: `#${r.unitNumber}`,
        description: r.vin,
        href: appHref(actor, `/equipment/${key}/${r.id}`),
      }))
    },
  }
}

/* ── Loads (registry entry for another agent's domain) ──────────────────── */

const loadProvider: SearchProvider = {
  key: 'loads',
  permission: 'load:read',
  async run(db, actor, scope, query) {
    const like = `%${query}%`
    const textMatch = ilike(loads.loadNumber, like)

    if (scope === 'tenant' || scope === 'platform') {
      return queryLoads(db, actor, and(eq(loads.tenantId, actor.tenantId!), isNull(loads.deletedAt), textMatch))
    }
    if (scope === 'assigned') {
      const ids = idListOrNull(actor.assignments.carrierIds)
      if (!ids) return []
      return queryLoads(
        db,
        actor,
        and(eq(loads.tenantId, actor.tenantId!), isNull(loads.deletedAt), textMatch, inArray(loads.carrierId, ids)),
      )
    }
    if (scope === 'carrier') {
      if (!actor.carrierId) return []
      return queryLoads(
        db,
        actor,
        and(eq(loads.tenantId, actor.tenantId!), isNull(loads.deletedAt), textMatch, eq(loads.carrierId, actor.carrierId)),
      )
    }
    if (scope === 'own') {
      if (!actor.driverId) return []
      const assignedLoadIds = await db
        .select({ loadId: loadAssignments.loadId })
        .from(loadAssignments)
        .where(and(eq(loadAssignments.tenantId, actor.tenantId!), eq(loadAssignments.driverId, actor.driverId), isNull(loadAssignments.unassignedAt)))
      const ids = idListOrNull(assignedLoadIds.map((r) => r.loadId))
      if (!ids) return []
      return queryLoads(
        db,
        actor,
        and(eq(loads.tenantId, actor.tenantId!), isNull(loads.deletedAt), textMatch, inArray(loads.id, ids)),
      )
    }
    return []
  },
}

async function queryLoads(db: TenantQueryable, actor: Actor, where: SQL | undefined): Promise<GlobalSearchResultItem[]> {
  const rows = await db
    .select({ id: loads.id, loadNumber: loads.loadNumber, status: loads.status })
    .from(loads)
    .where(where)
    .limit(RESULTS_PER_GROUP)
  return rows.map((r) => ({
    id: r.id,
    label: r.loadNumber,
    description: r.status,
    href: appHref(actor, `/loads/${r.id}`),
  }))
}

/* ── Invoices (registry entry for another agent's domain) ────────────────── */

const invoiceProvider: SearchProvider = {
  key: 'invoices',
  permission: 'invoice:read',
  async run(db, actor, scope, query) {
    const like = `%${query}%`
    const textMatch = ilike(invoices.invoiceNumber, like)

    let scopeCondition: SQL | undefined
    if (scope === 'assigned') {
      const ids = idListOrNull(actor.assignments.carrierIds)
      if (!ids) return []
      scopeCondition = inArray(invoices.carrierId, ids)
    } else if (scope === 'carrier') {
      if (!actor.carrierId) return []
      scopeCondition = eq(invoices.carrierId, actor.carrierId)
    } else if (scope === 'own') {
      return []
    }

    const rows = await db
      .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.tenantId, actor.tenantId!), isNull(invoices.deletedAt), textMatch, scopeCondition))
      .limit(RESULTS_PER_GROUP)

    return rows.map((r) => ({
      id: r.id,
      label: r.invoiceNumber,
      description: r.status,
      href: appHref(actor, `/invoices/${r.id}`),
    }))
  },
}

/* ── Registry ────────────────────────────────────────────────────────────── */

export const SEARCH_PROVIDERS: SearchProvider[] = [
  carrierProvider,
  customerProvider,
  driverProvider,
  equipmentProvider('trucks'),
  equipmentProvider('trailers'),
  loadProvider,
  invoiceProvider,
]

export async function globalSearch(actor: Actor, query: string): Promise<GlobalSearchResults> {
  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY_LENGTH || !actor.tenantId) return {}

  const db = tenantDb(actor.tenantId).builderRequiringExplicitTenantPredicate

  const entries = await Promise.all(
    SEARCH_PROVIDERS.map(async (provider) => {
      const decision = can(actor, provider.permission)
      if (!decision.allowed || !decision.scope) return null
      try {
        const items = await provider.run(db, actor, decision.scope, trimmed)
        return items.length > 0 ? ([provider.key, items] as const) : null
      } catch {
        // A single provider failing (e.g. a table another agent is still
        // migrating) must not take down the rest of the search results.
        return null
      }
    }),
  )

  const results: GlobalSearchResults = {}
  for (const entry of entries) {
    if (entry) results[entry[0]] = entry[1]
  }
  return results
}
