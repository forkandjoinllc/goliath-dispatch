import 'server-only'
import { and, asc, desc, eq, ilike, inArray, isNull, lte, ne, or, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  auditEvents,
  carriers,
  documents,
  driverCarrierRelationships,
  drivers,
  loadAssignments,
  loads,
  userTenantMemberships,
  type AuditEvent,
  type Carrier,
  type Document,
  type Driver,
  type DriverCarrierRelationship,
  type Load,
  type LoadAssignment,
  type UserTenantMembership,
} from '@/db/schema'
import type { ScopeFilter } from '@/lib/permissions/check'
import type { Pagination } from '@/lib/validation'
import { evaluateDriverForLoad } from '@/server/compliance/service'
import { mergeComplianceResults, scheduleGate, type ComplianceResult } from '@/server/compliance'
import { activeRelationshipWindow, findPendingDriverInvitation } from './service'

/**
 * Read models for drivers.
 *
 * A Carrier user sees only drivers reachable through an active relationship
 * to their own carrier; a Dispatcher sees drivers reachable through assigned
 * carriers — the latter is already fully expanded into
 * `scope.driverIds`/`scope.carrierIds` by `loadDispatcherAssignments()` in
 * `server/context.ts`, so the `assigned` branch below is a plain
 * `inArray`/relationship-exists check, not a re-derivation of that logic.
 */

async function carrierScopedDriverIds(db: TenantDb, carrierId: string): Promise<string[]> {
  const rows = await db.findMany(driverCarrierRelationships, {
    where: and(eq(driverCarrierRelationships.carrierId, carrierId), activeRelationshipWindow())!,
  })
  return [...new Set(rows.map((r) => r.driverId))]
}

export interface ListDriversOptions {
  status?: Driver['status']
  verificationStatus?: Driver['verificationStatus']
  carrierId?: string
  expiringLicenseWithinDays?: number
  expiringMedicalCardWithinDays?: number
  search?: string
  pagination?: Pagination
}

export interface ListDriversResult {
  rows: Driver[]
  total: number
}

function daysFromNow(days: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export async function listDrivers(
  db: TenantDb,
  scope: ScopeFilter,
  options: ListDriversOptions = {},
): Promise<ListDriversResult> {
  let scopedIds: string[] | null = null

  if (scope.kind === 'carrier') {
    if (!scope.carrierId) return { rows: [], total: 0 }
    scopedIds = await carrierScopedDriverIds(db, scope.carrierId)
    if (scopedIds.length === 0) return { rows: [], total: 0 }
  } else if (scope.kind === 'assigned') {
    scopedIds = scope.driverIds
    if (scopedIds.length === 0) return { rows: [], total: 0 }
  } else if (scope.kind === 'own') {
    scopedIds = scope.driverId ? [scope.driverId] : []
    if (scopedIds.length === 0) return { rows: [], total: 0 }
  }

  const clauses: SQL[] = []
  if (scopedIds) clauses.push(inArray(drivers.id, scopedIds))
  if (options.carrierId) {
    const ids = await carrierScopedDriverIds(db, options.carrierId)
    clauses.push(ids.length > 0 ? inArray(drivers.id, ids) : ne(drivers.id, drivers.id))
  }
  if (options.status) clauses.push(eq(drivers.status, options.status))
  if (options.verificationStatus) clauses.push(eq(drivers.verificationStatus, options.verificationStatus))
  if (options.expiringLicenseWithinDays != null) {
    clauses.push(lte(drivers.licenseExpiresAt, daysFromNow(options.expiringLicenseWithinDays)))
  }
  if (options.expiringMedicalCardWithinDays != null) {
    clauses.push(lte(drivers.medicalCardExpiresAt, daysFromNow(options.expiringMedicalCardWithinDays)))
  }
  if (options.search) {
    clauses.push(or(ilike(drivers.firstName, `%${options.search}%`), ilike(drivers.lastName, `%${options.search}%`))!)
  }

  const where = clauses.length > 0 ? and(...clauses) : undefined
  const pagination = options.pagination ?? { page: 1, pageSize: 25 }

  const [rows, total] = await Promise.all([
    db.findMany(drivers, {
      where,
      orderBy: [asc(drivers.lastName), asc(drivers.firstName)],
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(drivers, where),
  ])

  return { rows, total }
}

/** Licence expirations, independent of scope — used by the tenant-wide compliance sweep and the "expiring soon" screen. */
export async function listDriversWithExpiringLicense(db: TenantDb, withinDays: number): Promise<Driver[]> {
  return db.findMany(drivers, {
    where: lte(drivers.licenseExpiresAt, daysFromNow(withinDays)),
    orderBy: asc(drivers.licenseExpiresAt),
  })
}

export async function listDriversWithExpiringMedicalCard(db: TenantDb, withinDays: number): Promise<Driver[]> {
  return db.findMany(drivers, {
    where: lte(drivers.medicalCardExpiresAt, daysFromNow(withinDays)),
    orderBy: asc(drivers.medicalCardExpiresAt),
  })
}

/* ── Detail view ─────────────────────────────────────────────────────────── */

export interface DriverCarrierRelationshipView {
  relationship: DriverCarrierRelationship
  carrier: Carrier
  compliance: ComplianceResult
}

export interface DriverDetail {
  driver: Driver
  carrierRelationships: DriverCarrierRelationshipView[]
  documents: Document[]
  loadCommitments: Array<{ assignment: LoadAssignment; load: Load }>
}

export async function getDriverDetail(db: TenantDb, driverId: string): Promise<DriverDetail> {
  const driver = await db.requireById(drivers, driverId, 'driver')

  const relationships = await db.findMany(driverCarrierRelationships, {
    where: eq(driverCarrierRelationships.driverId, driverId),
    orderBy: desc(driverCarrierRelationships.startDate),
  })
  const carrierIds = [...new Set(relationships.map((r) => r.carrierId))]
  const relatedCarriers = carrierIds.length > 0 ? await db.findMany(carriers, { where: inArray(carriers.id, carrierIds) }) : []
  const carrierById = new Map(relatedCarriers.map((c) => [c.id, c]))

  const carrierRelationships: DriverCarrierRelationshipView[] = []
  for (const relationship of relationships) {
    const carrier = carrierById.get(relationship.carrierId)
    if (!carrier) continue
    const compliance = await evaluateDriverForLoad(db, { driverId, carrierId: relationship.carrierId })
    carrierRelationships.push({ relationship, carrier, compliance })
  }

  const docs = await db.findMany(documents, {
    where: and(eq(documents.ownerType, 'driver'), eq(documents.ownerId, driverId))!,
    orderBy: desc(documents.createdAt),
  })

  const commitmentRows = await db.findMany(loadAssignments, {
    where: and(eq(loadAssignments.driverId, driverId), isNull(loadAssignments.unassignedAt))!,
    orderBy: desc(loadAssignments.committedFrom),
  })
  const loadIds = [...new Set(commitmentRows.map((r) => r.loadId))]
  const relatedLoads = loadIds.length > 0 ? await db.findMany(loads, { where: inArray(loads.id, loadIds) }) : []
  const loadById = new Map(relatedLoads.map((l) => [l.id, l]))
  const loadCommitments = commitmentRows
    .map((assignment) => {
      const load = loadById.get(assignment.loadId)
      return load ? { assignment, load } : null
    })
    .filter((v): v is { assignment: LoadAssignment; load: Load } => v !== null)

  return { driver, carrierRelationships, documents: docs, loadCommitments }
}

/* ── Candidates for a load ───────────────────────────────────────────────── */

export interface DriverCandidate {
  driver: Driver
  compliance: ComplianceResult
}

export interface AvailableDriverWindow {
  from: Date
  to: Date
}

/**
 * Candidates for a specific load's carrier, each annotated with the exact
 * blocking reasons that would prevent assignment right now. Mirrors
 * `server/equipment/queries.ts::availableEquipmentForLoad` — see that
 * function's comment for why the schedule check is re-loaded here instead of
 * reusing the load's own saved dates.
 */
export async function availableDriversForLoad(
  db: TenantDb,
  loadId: string,
  window: AvailableDriverWindow,
  options: { carrierId: string },
): Promise<DriverCandidate[]> {
  const relationshipRows = await db.findMany(driverCarrierRelationships, {
    where: and(eq(driverCarrierRelationships.carrierId, options.carrierId), activeRelationshipWindow())!,
  })
  const driverIds = [...new Set(relationshipRows.map((r) => r.driverId))]
  if (driverIds.length === 0) return []

  const candidates = await db.findMany(drivers, {
    where: and(inArray(drivers.id, driverIds), ne(drivers.status, 'inactive'))!,
  })
  if (candidates.length === 0) return []

  const activeAssignments = await db.findMany(loadAssignments, {
    where: and(
      inArray(loadAssignments.driverId, candidates.map((c) => c.id)),
      isNull(loadAssignments.unassignedAt),
      ne(loadAssignments.loadId, loadId),
    )!,
  })
  const relatedLoadIds = [...new Set(activeAssignments.map((a) => a.loadId))]
  const relatedLoads = relatedLoadIds.length > 0 ? await db.findMany(loads, { where: inArray(loads.id, relatedLoadIds) }) : []
  const loadNumberById = new Map(relatedLoads.map((l) => [l.id, l.loadNumber]))

  const commitmentsByDriver = new Map<string, Array<{ loadNumber: string; committedFrom: Date | null; committedTo: Date | null }>>()
  for (const assignment of activeAssignments) {
    if (!assignment.driverId) continue
    const list = commitmentsByDriver.get(assignment.driverId) ?? []
    list.push({
      loadNumber: loadNumberById.get(assignment.loadId) ?? assignment.loadId,
      committedFrom: assignment.committedFrom,
      committedTo: assignment.committedTo,
    })
    commitmentsByDriver.set(assignment.driverId, list)
  }

  return Promise.all(
    candidates.map(async (driver) => {
      const [resourceResult, scheduleResult] = await Promise.all([
        evaluateDriverForLoad(db, { driverId: driver.id, carrierId: options.carrierId }),
        Promise.resolve(
          scheduleGate({
            resourceType: 'driver',
            resourceLabel: `${driver.firstName} ${driver.lastName}`,
            candidateWindow: window,
            existingCommitments: commitmentsByDriver.get(driver.id) ?? [],
          }),
        ),
      ])
      return { driver, compliance: mergeComplianceResults([resourceResult, scheduleResult]) }
    }),
  )
}

/**
 * Resolves a `ResourceContext` for one driver from the real row, mirroring
 * `equipment/queries.ts::getEquipmentResourceContext` — used by the driver
 * detail page so `loadFor(permission, resource)` gets a real scope check
 * before rendering, rather than trusting the URL's driver id blindly.
 *
 * `carrierId` only gets set when `actorCarrierId` genuinely has an active
 * relationship with this driver — mirrors `driverResource()` in
 * `drivers/actions.ts` exactly (a driver's carrier link is many-to-many, so
 * this can't be read off the driver row itself the way equipment's can).
 * Without this, a `carrier`-scoped actor's `driver:read` check
 * (`resource.carrierId === actor.carrierId` in `lib/permissions/check.ts`)
 * always failed — `resource.carrierId` was never anything but `undefined` —
 * so no Carrier-portal user could ever open any driver's detail page.
 */
export async function getDriverResourceContext(
  db: TenantDb,
  driverId: string,
  actorCarrierId?: string | null,
): Promise<{ tenantId: string | null; driverId: string; ownerUserId?: string; carrierId?: string | null }> {
  const driver = await db.findById(drivers, driverId)

  let carrierId: string | null = null
  if (actorCarrierId) {
    const hasRelationship = await db.exists(
      driverCarrierRelationships,
      and(
        eq(driverCarrierRelationships.driverId, driverId),
        eq(driverCarrierRelationships.carrierId, actorCarrierId),
        activeRelationshipWindow(),
      )!,
    )
    if (hasRelationship) carrierId = actorCarrierId
  }

  return { tenantId: driver?.tenantId ?? null, driverId, ownerUserId: driver?.userId ?? undefined, carrierId }
}

/* ── Portal access ────────────────────────────────────────────────────────── */

export interface DriverPortalAccess {
  linkedUserId: string | null
  membership: UserTenantMembership | null
  pendingInvitation: { email: string; invitedAt: Date; expiresAt: Date } | null
}

/**
 * Backs the driver detail screen's "Portal access" section: whether this
 * driver has a login at all, its membership status, and — when there isn't
 * one yet — whether an invitation is still outstanding.
 */
export async function getDriverPortalAccess(db: TenantDb, driverId: string): Promise<DriverPortalAccess> {
  const driver = await db.requireById(drivers, driverId, 'driver')

  let membership: UserTenantMembership | null = null
  if (driver.userId) {
    membership = await db.findFirst(userTenantMemberships, {
      where: and(eq(userTenantMemberships.userId, driver.userId), eq(userTenantMemberships.driverId, driverId))!,
    })
  }

  const pendingInvitation = driver.userId ? null : await findPendingDriverInvitation(db, driverId)

  return { linkedUserId: driver.userId, membership, pendingInvitation }
}

/**
 * Audit trail for one driver's History tab. `driver.license.review` is the
 * only `driver.*` audit action today (see `actions.ts`) and it records the
 * driver's own id as `entityId`, so — unlike equipment media, whose
 * `entityId` is the media row — this is a direct `entityId` match.
 */
export async function listDriverAuditHistory(db: TenantDb, driverId: string): Promise<AuditEvent[]> {
  return db.findMany(auditEvents, {
    where: and(eq(auditEvents.entityType, 'driver'), eq(auditEvents.entityId, driverId))!,
    orderBy: desc(auditEvents.occurredAt),
  })
}
