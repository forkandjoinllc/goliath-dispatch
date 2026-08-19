import 'server-only'
import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  carriers,
  checkCalls,
  customers,
  dispatcherProfiles,
  documentVersions,
  documents,
  expenses,
  financialSnapshots,
  invoices,
  jobQueue,
  loadAssignments,
  loadDocuments,
  loadStatusHistory,
  loadStops,
  loads,
  rateConfirmationAcceptances,
  tenantSettings,
  type CheckCall,
  type Load,
  type LoadAssignment,
  type LoadStop,
  type RateConfirmationAcceptance,
} from '@/db/schema'
import type { CommissionBasis } from '@/lib/money'
import { FORMULA_VERSION, calculateLoadFinancials, groupApprovedExpenses } from '@/lib/money'
import { AppError, notFound } from '@/lib/errors'
import type { Role } from '@/lib/permissions'
import { getGeoProvider, type ResolvedAddress } from '@/integrations/geo'
import {
  evaluateAssignmentCandidate,
  evaluateCarrier,
  evaluateLoadForDispatch,
  type AssignmentCandidateResource,
  type ComplianceReason,
} from '@/server/compliance'
import { allocateLoadNumber } from './numbering'
import { calculateDetentionMinutes } from './detention'
import { canTransition, type LoadStatus, type TransitionContext, type TransitionSource } from './status-machine'

/**
 * The load domain.
 *
 * As with `carriers/service.ts` and `documents/service.ts`, nothing here
 * checks permissions — `defineAction` already did. This layer owns: load
 * numbering, the stop-sequence invariant, financial snapshotting
 * (`calculateLoadFinancials` and nothing else ever computes load money —
 * see `docs/architecture.md` §6), carrier immutability once locked, the
 * compliance-gated resource assignment path, and the status machine's
 * database-facing half (loading the readiness facts `canTransition` needs).
 */

export interface RequestContext {
  ipAddress: string | null
  userAgent: string | null
}

/* ── Oversize heuristic ──────────────────────────────────────────────────── */

/**
 * Conservative "no permit needed" thresholds for a standard US combination
 * vehicle. This is a load-record convenience flag, not a legal
 * determination — the oversize/permit domain's own rule engine (state by
 * state, not built in this release) is the authority once a load actually
 * needs a permit; this only decides whether the flag defaults to true so
 * the form's live indicator and the dispatch gate agree on what "oversize"
 * means for an unevaluated load.
 */
export const STANDARD_MAX_WIDTH_INCHES = 102
export const STANDARD_MAX_HEIGHT_INCHES = 162
export const STANDARD_MAX_LENGTH_INCHES = 636
export const STANDARD_MAX_GVW_POUNDS = 80_000

export interface OversizeFlagInputs {
  widthInches?: number | null
  heightInches?: number | null
  lengthInches?: number | null
  grossVehicleWeightPounds?: number | null
}

export function computeOversizeFlags(input: OversizeFlagInputs): { isOversize: boolean; isOverweight: boolean } {
  const isOversize = Boolean(
    (input.widthInches && input.widthInches > STANDARD_MAX_WIDTH_INCHES) ||
      (input.heightInches && input.heightInches > STANDARD_MAX_HEIGHT_INCHES) ||
      (input.lengthInches && input.lengthInches > STANDARD_MAX_LENGTH_INCHES),
  )
  const isOverweight = Boolean(
    input.grossVehicleWeightPounds && input.grossVehicleWeightPounds > STANDARD_MAX_GVW_POUNDS,
  )
  return { isOversize, isOverweight }
}

/* ── Stop address geocoding ──────────────────────────────────────────────── */

interface StopAddressInput {
  line1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  placeId?: string | null
}

interface ResolvedStopGeo {
  latitude: string | null
  longitude: string | null
  placeId: string | null
  timezone: string
}

const DEFAULT_TIMEZONE = 'America/New_York'

/** Mirrors `customers/service.ts::resolveLocationGeo` — see that function's comment. */
async function resolveStopGeo(input: StopAddressInput): Promise<ResolvedStopGeo> {
  const geo = getGeoProvider()
  let resolved: ResolvedAddress | null = null

  if (input.placeId) {
    resolved = await geo.resolvePlace(input.placeId).catch(() => null)
  }
  if (!resolved) {
    const freeText = [input.line1, input.city, input.state, input.postalCode].filter(Boolean).join(', ')
    if (freeText) resolved = await geo.geocode(freeText).catch(() => null)
  }
  if (!resolved) {
    return { latitude: null, longitude: null, placeId: input.placeId ?? null, timezone: DEFAULT_TIMEZONE }
  }

  const timezone = resolved.timezone ?? (await geo.timezoneAt(resolved.lat, resolved.lng, new Date()).catch(() => null))
  return {
    latitude: String(resolved.lat),
    longitude: String(resolved.lng),
    placeId: resolved.placeId ?? input.placeId ?? null,
    timezone: timezone ?? DEFAULT_TIMEZONE,
  }
}

/* ── Financial snapshotting ──────────────────────────────────────────────── */

/**
 * Writes the next `financial_snapshots` version for a load, computed
 * exclusively through `calculateLoadFinancials` (see architecture §6 — no
 * other formula is ever allowed to touch load money). Called once at
 * creation and again any time a financial input on the load changes.
 */
async function recordFinancialSnapshot(
  db: TenantDb,
  load: Load,
  reason: string,
  computedByUserId: string | null,
): Promise<void> {
  const previous = await db.findFirst(financialSnapshots, {
    where: eq(financialSnapshots.loadId, load.id),
    orderBy: desc(financialSnapshots.version),
  })
  const version = (previous?.version ?? 0) + 1

  const expenseRows = await db.findMany(expenses, { where: eq(expenses.loadId, load.id) })
  const grouped = groupApprovedExpenses(
    expenseRows.map((expense) => ({
      amountCents: expense.amountCents,
      treatmentSnapshot: expense.treatmentSnapshot,
      status: expense.status,
    })),
  )

  const outputs = calculateLoadFinancials({
    customerChargeCents: load.customerChargeCents,
    carrierGrossRateCents: load.carrierGrossRateCents,
    carrierDispatchFeeBps: load.carrierDispatchFeeBps,
    dispatcherCommissionBps: load.dispatcherCommissionBps,
    dispatcherCommissionBasis: load.dispatcherCommissionBasis as CommissionBasis,
    ...grouped,
  })

  await db.insert(financialSnapshots, {
    loadId: load.id,
    version,
    customerChargeCents: load.customerChargeCents,
    carrierGrossRateCents: load.carrierGrossRateCents,
    carrierDispatchFeeBps: load.carrierDispatchFeeBps,
    dispatcherCommissionBps: load.dispatcherCommissionBps,
    dispatcherCommissionBasis: load.dispatcherCommissionBasis,
    approvedExcludedExpensesCents: grouped.approvedExcludedExpensesCents,
    approvedReimbursableExpensesCents: grouped.approvedReimbursableExpensesCents,
    tenantAbsorbedExpensesCents: grouped.tenantAbsorbedExpensesCents,
    carrierDeductionsCents: grouped.carrierDeductionsCents,
    commissionableBaseCents: outputs.commissionableBaseCents,
    dispatchFeeAmountCents: outputs.dispatchFeeAmountCents,
    netCarrierSettlementCents: outputs.netCarrierSettlementCents,
    grossMarginCents: outputs.grossMarginCents,
    dispatcherCommissionAmountCents: outputs.dispatcherCommissionAmountCents,
    formulaVersion: FORMULA_VERSION,
    reason,
    computedByUserId,
  })
}

/* ── Create ──────────────────────────────────────────────────────────────── */

export interface CreateLoadStopInput {
  stopType: 'pickup' | 'delivery'
  facilityName?: string | null
  customerLocationId?: string | null
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  placeId?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  confirmationNumber?: string | null
  instructions?: string | null
  appointmentType: 'exact' | 'window' | 'fcfs' | 'open'
  windowStart?: Date | null
  windowEnd?: Date | null
}

export interface CreateLoadInput {
  customerId: string
  customerContactId?: string | null
  carrierId?: string | null
  dispatcherUserId?: string | null
  customerReference?: string | null
  poNumber?: string | null
  commodity?: string | null
  weightPounds?: number | null
  lengthInches?: number | null
  widthInches?: number | null
  heightInches?: number | null
  pieceCount?: number | null
  requiredEquipmentTypeId?: string | null
  axleConfiguration?: string | null
  grossVehicleWeightPounds?: number | null
  specialInstructions?: string | null
  internalNotes?: string | null
  customerChargeCents?: number
  carrierGrossRateCents?: number
  carrierDispatchFeeBps?: number
  dispatcherCommissionBps?: number
  dispatcherCommissionBasis?: CommissionBasis
  stops: CreateLoadStopInput[]
}

export interface CreateLoadResult {
  load: Load
  stops: LoadStop[]
}

export async function createLoad(
  db: TenantDb,
  actor: { userId: string; role: Role | null },
  input: CreateLoadInput,
): Promise<CreateLoadResult> {
  await db.requireById(customers, input.customerId, 'customer')

  const pickups = input.stops.filter((stop) => stop.stopType === 'pickup')
  const deliveries = input.stops.filter((stop) => stop.stopType === 'delivery')
  if (pickups.length === 0 || deliveries.length === 0) {
    throw new AppError('validation_failed', 'load.errors.stopsRequired')
  }

  const carrier = input.carrierId ? await db.requireById(carriers, input.carrierId, 'carrier') : null
  const settings = await db.findFirst(tenantSettings)

  const dispatcherUserId = input.dispatcherUserId ?? (actor.role === 'dispatcher' ? actor.userId : null)

  let dispatcherCommissionBps = input.dispatcherCommissionBps
  if (dispatcherCommissionBps == null && dispatcherUserId) {
    const profile = await db.findFirst(dispatcherProfiles, { where: eq(dispatcherProfiles.userId, dispatcherUserId) })
    dispatcherCommissionBps = profile?.commissionBps
  }
  dispatcherCommissionBps ??= settings?.defaultDispatcherCommissionBps ?? 2500

  const carrierDispatchFeeBps = input.carrierDispatchFeeBps ?? carrier?.dispatchFeeBps ?? settings?.defaultCarrierDispatchFeeBps ?? 1000
  const dispatcherCommissionBasis: CommissionBasis =
    input.dispatcherCommissionBasis ?? settings?.dispatcherCommissionBasis ?? 'dispatch_fee_amount'

  const { isOversize, isOverweight } = computeOversizeFlags(input)

  const firstPickup = input.stops.find((stop) => stop.stopType === 'pickup')
  const lastDelivery = [...input.stops].reverse().find((stop) => stop.stopType === 'delivery')

  const resolvedGeo = await Promise.all(input.stops.map((stop) => resolveStopGeo(stop)))

  return db.transaction(async (tx) => {
    const loadNumber = await allocateLoadNumber(tx)

    const load = await tx.insert(loads, {
      loadNumber,
      customerReference: input.customerReference ?? null,
      poNumber: input.poNumber ?? null,
      customerId: input.customerId,
      customerContactId: input.customerContactId ?? null,
      carrierId: input.carrierId ?? null,
      dispatcherUserId,
      status: 'draft',
      commodity: input.commodity ?? null,
      weightPounds: input.weightPounds ?? null,
      lengthInches: input.lengthInches ?? null,
      widthInches: input.widthInches ?? null,
      heightInches: input.heightInches ?? null,
      pieceCount: input.pieceCount ?? null,
      requiredEquipmentTypeId: input.requiredEquipmentTypeId ?? null,
      isOversize,
      isOverweight,
      axleConfiguration: input.axleConfiguration ?? null,
      grossVehicleWeightPounds: input.grossVehicleWeightPounds ?? null,
      customerChargeCents: input.customerChargeCents ?? 0,
      carrierGrossRateCents: input.carrierGrossRateCents ?? 0,
      carrierDispatchFeeBps,
      dispatcherCommissionBps,
      dispatcherCommissionBasis,
      specialInstructions: input.specialInstructions ?? null,
      internalNotes: input.internalNotes ?? null,
      plannedPickupAt: firstPickup?.windowStart ?? null,
      plannedDeliveryAt: lastDelivery?.windowEnd ?? lastDelivery?.windowStart ?? null,
    })

    const stopRows = await tx.insertMany(
      loadStops,
      input.stops.map((stop, index) => ({
        loadId: load.id,
        stopType: stop.stopType,
        sequence: index + 1,
        facilityName: stop.facilityName ?? null,
        customerLocationId: stop.customerLocationId ?? null,
        line1: stop.line1 ?? null,
        line2: stop.line2 ?? null,
        city: stop.city ?? null,
        state: stop.state ?? null,
        postalCode: stop.postalCode ?? null,
        placeId: resolvedGeo[index]!.placeId,
        latitude: resolvedGeo[index]!.latitude,
        longitude: resolvedGeo[index]!.longitude,
        timezone: resolvedGeo[index]!.timezone,
        contactName: stop.contactName ?? null,
        contactPhone: stop.contactPhone ?? null,
        contactEmail: stop.contactEmail ?? null,
        confirmationNumber: stop.confirmationNumber ?? null,
        instructions: stop.instructions ?? null,
        appointmentType: stop.appointmentType,
        windowStart: stop.windowStart ?? null,
        windowEnd: stop.windowEnd ?? null,
      })),
    )

    await recordFinancialSnapshot(tx, load, 'load_created', actor.userId)

    return { load, stops: stopRows }
  })
}

/* ── Update ──────────────────────────────────────────────────────────────── */

export interface UpdateLoadInput {
  customerId?: string
  customerContactId?: string | null
  dispatcherUserId?: string | null
  customerReference?: string | null
  poNumber?: string | null
  commodity?: string | null
  weightPounds?: number | null
  lengthInches?: number | null
  widthInches?: number | null
  heightInches?: number | null
  pieceCount?: number | null
  requiredEquipmentTypeId?: string | null
  axleConfiguration?: string | null
  grossVehicleWeightPounds?: number | null
  specialInstructions?: string | null
  internalNotes?: string | null
  customerChargeCents?: number
  carrierGrossRateCents?: number
  carrierDispatchFeeBps?: number
  dispatcherCommissionBps?: number
  dispatcherCommissionBasis?: CommissionBasis
}

const FINANCIAL_KEYS: (keyof UpdateLoadInput)[] = [
  'customerChargeCents',
  'carrierGrossRateCents',
  'carrierDispatchFeeBps',
  'dispatcherCommissionBps',
  'dispatcherCommissionBasis',
]

/**
 * Edits load details. The carrier is never touched here — `assignCarrier` is
 * the only path that may set it, and once `carrierLockedAt` is set at all,
 * neither path may change it (the caller is guided to cancel or duplicate
 * the load instead, per `errors.carrierLocked`).
 */
export async function updateLoad(
  db: TenantDb,
  actor: { userId: string },
  loadId: string,
  input: UpdateLoadInput,
): Promise<Load> {
  const existing = await db.requireById(loads, loadId, 'load')

  const patch: Partial<Load> = {}
  if (input.customerId !== undefined) patch.customerId = input.customerId
  if (input.customerContactId !== undefined) patch.customerContactId = input.customerContactId
  if (input.dispatcherUserId !== undefined) patch.dispatcherUserId = input.dispatcherUserId
  if (input.customerReference !== undefined) patch.customerReference = input.customerReference
  if (input.poNumber !== undefined) patch.poNumber = input.poNumber
  if (input.commodity !== undefined) patch.commodity = input.commodity
  if (input.weightPounds !== undefined) patch.weightPounds = input.weightPounds
  if (input.lengthInches !== undefined) patch.lengthInches = input.lengthInches
  if (input.widthInches !== undefined) patch.widthInches = input.widthInches
  if (input.heightInches !== undefined) patch.heightInches = input.heightInches
  if (input.pieceCount !== undefined) patch.pieceCount = input.pieceCount
  if (input.requiredEquipmentTypeId !== undefined) patch.requiredEquipmentTypeId = input.requiredEquipmentTypeId
  if (input.axleConfiguration !== undefined) patch.axleConfiguration = input.axleConfiguration
  if (input.grossVehicleWeightPounds !== undefined) patch.grossVehicleWeightPounds = input.grossVehicleWeightPounds
  if (input.specialInstructions !== undefined) patch.specialInstructions = input.specialInstructions
  if (input.internalNotes !== undefined) patch.internalNotes = input.internalNotes
  if (input.customerChargeCents !== undefined) patch.customerChargeCents = input.customerChargeCents
  if (input.carrierGrossRateCents !== undefined) patch.carrierGrossRateCents = input.carrierGrossRateCents
  if (input.carrierDispatchFeeBps !== undefined) patch.carrierDispatchFeeBps = input.carrierDispatchFeeBps
  if (input.dispatcherCommissionBps !== undefined) patch.dispatcherCommissionBps = input.dispatcherCommissionBps
  if (input.dispatcherCommissionBasis !== undefined) patch.dispatcherCommissionBasis = input.dispatcherCommissionBasis

  if (
    input.widthInches !== undefined ||
    input.heightInches !== undefined ||
    input.lengthInches !== undefined ||
    input.grossVehicleWeightPounds !== undefined
  ) {
    const flags = computeOversizeFlags({
      widthInches: input.widthInches ?? existing.widthInches,
      heightInches: input.heightInches ?? existing.heightInches,
      lengthInches: input.lengthInches ?? existing.lengthInches,
      grossVehicleWeightPounds: input.grossVehicleWeightPounds ?? existing.grossVehicleWeightPounds,
    })
    patch.isOversize = flags.isOversize
    patch.isOverweight = flags.isOverweight
  }

  const updated = await db.update(loads, loadId, patch)
  if (!updated) throw notFound('errors.notFound', { entity: 'load' })

  if (FINANCIAL_KEYS.some((key) => input[key] !== undefined)) {
    await recordFinancialSnapshot(db, updated, 'load_updated', actor.userId)
  }

  return updated
}

/* ── Carrier assignment ──────────────────────────────────────────────────── */

export async function assignCarrier(
  db: TenantDb,
  actor: { userId: string },
  input: { loadId: string; carrierId: string },
): Promise<Load> {
  const load = await db.requireById(loads, input.loadId, 'load')
  if (load.carrierLockedAt) {
    throw new AppError('immutable', 'errors.carrierLocked')
  }

  const compliance = await evaluateCarrier(db, input.carrierId)
  if (!compliance.ok) {
    throw new AppError('compliance_blocked', 'load.errors.carrierNotCompliant', {
      params: { count: compliance.blocking.length },
    })
  }

  const carrier = await db.requireById(carriers, input.carrierId, 'carrier')
  const now = new Date()

  return db.transaction(async (tx) => {
    const updated = await tx.update(loads, input.loadId, {
      carrierId: input.carrierId,
      carrierLockedAt: now,
      carrierDispatchFeeBps: load.carrierDispatchFeeBps || carrier.dispatchFeeBps,
    })
    if (!updated) throw notFound('errors.notFound', { entity: 'load' })
    await recordFinancialSnapshot(tx, updated, 'carrier_assigned', actor.userId)
    return updated
  })
}

/* ── Resource assignment ─────────────────────────────────────────────────── */

export interface AssignResourcesInput {
  loadId: string
  truckIds?: string[]
  trailerIds?: string[]
  driverIds?: string[]
}

export interface BlockedAssignmentCandidate {
  resourceType: 'truck' | 'trailer' | 'driver'
  resourceId: string
  reasons: ComplianceReason[]
}

export type AssignResourcesResult =
  | { status: 'assigned'; assignments: LoadAssignment[] }
  | { status: 'blocked'; blocked: BlockedAssignmentCandidate[] }

/**
 * Evaluates every candidate before committing anything — a single blocking
 * candidate refuses the whole operation, and every blocked candidate's full
 * reason list is returned (not just the first), so the assignment dialog can
 * explain each one rather than making the dispatcher guess and retry.
 */
export async function assignResources(
  db: TenantDb,
  actor: { userId: string },
  input: AssignResourcesInput,
): Promise<AssignResourcesResult> {
  const load = await db.requireById(loads, input.loadId, 'load')
  if (!load.carrierId) {
    throw new AppError('validation_failed', 'load.errors.carrierRequiredForAssignment')
  }

  const candidates: AssignmentCandidateResource[] = [
    ...(input.truckIds ?? []).map((id) => ({ type: 'truck' as const, id })),
    ...(input.trailerIds ?? []).map((id) => ({ type: 'trailer' as const, id })),
    ...(input.driverIds ?? []).map((id) => ({ type: 'driver' as const, id })),
  ]
  if (candidates.length === 0) {
    throw new AppError('validation_failed', 'validation.required')
  }

  const evaluations = await Promise.all(
    candidates.map((candidate) => evaluateAssignmentCandidate(db, input.loadId, candidate)),
  )

  const blocked = candidates
    .map((candidate, index) => ({ candidate, compliance: evaluations[index]! }))
    .filter((entry) => !entry.compliance.ok)

  if (blocked.length > 0) {
    return {
      status: 'blocked',
      blocked: blocked.map((entry) => ({
        resourceType: entry.candidate.type,
        resourceId: entry.candidate.id,
        reasons: entry.compliance.blocking,
      })),
    }
  }

  const window = {
    from: load.plannedPickupAt ?? new Date(),
    to: load.plannedDeliveryAt ?? load.plannedPickupAt ?? new Date(),
  }

  return db.transaction(async (tx) => {
    const assignments: LoadAssignment[] = []
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!
      const compliance = evaluations[index]!
      const assignment = await tx.insert(loadAssignments, {
        loadId: input.loadId,
        resourceType: candidate.type,
        truckId: candidate.type === 'truck' ? candidate.id : null,
        trailerId: candidate.type === 'trailer' ? candidate.id : null,
        driverId: candidate.type === 'driver' ? candidate.id : null,
        isPrimary: false,
        committedFrom: window.from,
        committedTo: window.to,
        assignedByUserId: actor.userId,
        complianceSnapshot: compliance as unknown as Record<string, unknown>,
      })
      assignments.push(assignment)
    }
    return { status: 'assigned', assignments }
  })
}

export async function unassignResource(
  db: TenantDb,
  _actor: { userId: string },
  input: { assignmentId: string; reason: string },
): Promise<LoadAssignment> {
  if (!input.reason?.trim()) {
    throw new AppError('validation_failed', 'validation.required')
  }
  await db.requireById(loadAssignments, input.assignmentId, 'loadAssignment')
  const updated = await db.update(loadAssignments, input.assignmentId, {
    unassignedAt: new Date(),
    unassignedReason: input.reason,
  })
  if (!updated) throw notFound('errors.notFound', { entity: 'loadAssignment' })
  return updated
}

/* ── Status transitions ──────────────────────────────────────────────────── */

async function hasApprovedPod(db: TenantDb, loadId: string): Promise<boolean> {
  const links = await db.findMany(loadDocuments, {
    where: and(eq(loadDocuments.loadId, loadId), eq(loadDocuments.documentType, 'pod'))!,
  })
  if (links.length === 0) return false
  const documentIds = links.map((link) => link.documentId)
  const docs = await db.findMany(documents, { where: inArray(documents.id, documentIds) })
  return docs.some((doc) => doc.reviewStatus === 'approved')
}

export interface TransitionStatusInput {
  loadId: string
  to: LoadStatus
  notes?: string | null
  source?: TransitionSource
  sourceReference?: string | null
}

export async function transitionStatus(
  db: TenantDb,
  actor: { userId: string | null },
  request: RequestContext,
  input: TransitionStatusInput,
): Promise<Load> {
  const load = await db.requireById(loads, input.loadId, 'load')
  const from = load.status as LoadStatus
  const source: TransitionSource = input.source ?? 'user'

  const context: TransitionContext = {}
  if (input.to === 'assigned') context.hasCarrier = Boolean(load.carrierId)
  if (input.to === 'dispatched') {
    const compliance = await evaluateLoadForDispatch(db, input.loadId)
    context.dispatchGateOk = compliance.ok
  }
  if (input.to === 'pod_received') context.hasApprovedPod = await hasApprovedPod(db, input.loadId)
  if (input.to === 'invoiced') context.hasInvoice = await db.exists(invoices, eq(invoices.loadId, input.loadId))

  const decision = canTransition(from, input.to, context)
  if (!decision.allowed) {
    throw new AppError('conflict', decision.reasonKey ?? 'errors.loadStatusTransition', {
      params: decision.params ?? { from, to: input.to },
    })
  }

  return db.transaction(async (tx) => {
    const patch: Partial<Load> = { status: input.to }
    if (input.to === 'delivered' && !load.actualDeliveryAt) patch.actualDeliveryAt = new Date()
    if (input.to === 'pod_received') patch.podReceivedAt = new Date()

    const updated = await tx.update(loads, input.loadId, patch)
    if (!updated) throw notFound('errors.notFound', { entity: 'load' })

    await tx.insert(loadStatusHistory, {
      loadId: input.loadId,
      fromStatus: from,
      toStatus: input.to,
      actorUserId: actor.userId,
      source,
      sourceReference: input.sourceReference ?? null,
      notes: input.notes ?? null,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
    })

    if (input.to === 'pod_received') {
      // Jobs-agent wiring: kicks off `invoice.draft_from_pod`
      // (src/jobs/handlers/invoice-draft-from-pod.ts), which calls the
      // idempotent `createDraftInvoiceForLoad`. Keyed by load id alone (no
      // date/attempt suffix) so a retried transition, or a duplicate status
      // write from tracking ingestion, can never enqueue the draft twice —
      // the unique index on `job_queue.dedupe_key` is the actual guarantee;
      // the `exists` check just avoids a wasted round trip on the common path.
      const dedupeKey = `invoice.draft_from_pod:${input.loadId}`
      const alreadyQueued = await tx.exists(jobQueue, eq(jobQueue.dedupeKey, dedupeKey))
      if (!alreadyQueued) {
        await tx.insert(jobQueue, {
          jobType: 'invoice.draft_from_pod',
          payload: { loadId: input.loadId },
          dedupeKey,
        })
      }
    }

    return updated
  })
}

/* ── Cancellation ────────────────────────────────────────────────────────── */

export async function cancelLoad(
  db: TenantDb,
  actor: { userId: string | null },
  request: RequestContext,
  loadId: string,
  reason: string,
): Promise<Load> {
  if (!reason?.trim()) {
    throw new AppError('validation_failed', 'validation.required')
  }

  const load = await db.requireById(loads, loadId, 'load')
  const decision = canTransition(load.status as LoadStatus, 'cancelled')
  if (!decision.allowed) {
    throw new AppError('conflict', decision.reasonKey ?? 'errors.loadStatusTransition', {
      params: decision.params ?? { from: load.status, to: 'cancelled' },
    })
  }

  return db.transaction(async (tx) => {
    const updated = await tx.update(loads, loadId, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancellationReason: reason,
    })
    if (!updated) throw notFound('errors.notFound', { entity: 'load' })

    await tx.insert(loadStatusHistory, {
      loadId,
      fromStatus: load.status,
      toStatus: 'cancelled',
      actorUserId: actor.userId,
      source: 'user',
      notes: reason,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
    })

    await tx.updateWhere(
      loadAssignments,
      and(eq(loadAssignments.loadId, loadId), isNull(loadAssignments.unassignedAt))!,
      { unassignedAt: new Date(), unassignedReason: 'load_cancelled' },
    )

    return updated
  })
}

/* ── Duplication ─────────────────────────────────────────────────────────── */

/**
 * Copies customer, stops, dimensions, equipment requirement and financial
 * *percentages* into a new draft. Deliberately does not copy the carrier,
 * assignments, documents, status history or financial snapshots — those all
 * belong to the specific dispatch that happened, not to the freight
 * description being re-offered.
 */
export async function duplicateLoad(
  db: TenantDb,
  actor: { userId: string; role: Role | null },
  loadId: string,
): Promise<CreateLoadResult> {
  const source = await db.requireById(loads, loadId, 'load')
  const sourceStops = await db.findMany(loadStops, {
    where: eq(loadStops.loadId, loadId),
    orderBy: asc(loadStops.sequence),
  })

  const input: CreateLoadInput = {
    customerId: source.customerId,
    customerContactId: source.customerContactId,
    customerReference: source.customerReference,
    commodity: source.commodity,
    weightPounds: source.weightPounds,
    lengthInches: source.lengthInches,
    widthInches: source.widthInches,
    heightInches: source.heightInches,
    pieceCount: source.pieceCount,
    requiredEquipmentTypeId: source.requiredEquipmentTypeId,
    axleConfiguration: source.axleConfiguration,
    grossVehicleWeightPounds: source.grossVehicleWeightPounds,
    carrierDispatchFeeBps: source.carrierDispatchFeeBps,
    dispatcherCommissionBps: source.dispatcherCommissionBps,
    dispatcherCommissionBasis: source.dispatcherCommissionBasis,
    stops: sourceStops.map((stop) => ({
      stopType: stop.stopType,
      facilityName: stop.facilityName,
      customerLocationId: stop.customerLocationId,
      line1: stop.line1,
      line2: stop.line2,
      city: stop.city,
      state: stop.state,
      postalCode: stop.postalCode,
      placeId: stop.placeId,
      contactName: stop.contactName,
      contactPhone: stop.contactPhone,
      contactEmail: stop.contactEmail,
      confirmationNumber: stop.confirmationNumber,
      instructions: stop.instructions,
      appointmentType: stop.appointmentType,
      windowStart: null,
      windowEnd: null,
    })),
  }

  const result = await createLoad(db, actor, input)
  const relinked = await db.update(loads, result.load.id, { duplicatedFromLoadId: loadId })
  return { load: relinked ?? result.load, stops: result.stops }
}

/* ── Rate confirmation ───────────────────────────────────────────────────── */

export interface RecordRateConfirmationDecisionInput {
  loadId: string
  decision: 'accepted' | 'rejected' | 'changes_requested'
  reason?: string | null
}

export async function recordRateConfirmationDecision(
  db: TenantDb,
  actor: { userId: string },
  request: RequestContext,
  input: RecordRateConfirmationDecisionInput,
): Promise<RateConfirmationAcceptance> {
  if (input.decision !== 'accepted' && !input.reason?.trim()) {
    throw new AppError('validation_failed', 'validation.required')
  }

  const load = await db.requireById(loads, input.loadId, 'load')
  if (!load.carrierId) throw notFound('errors.notFound', { entity: 'carrier' })

  const link = await db.findFirst(loadDocuments, {
    where: and(eq(loadDocuments.loadId, input.loadId), eq(loadDocuments.documentType, 'rate_confirmation'))!,
    orderBy: desc(loadDocuments.createdAt),
  })
  if (!link) throw notFound('load.errors.rateConfirmationNotFound')

  const document = await db.requireById(documents, link.documentId, 'document')
  if (!document.currentVersionId) throw notFound('document.errors.versionNotFound')
  const version = await db.requireById(documentVersions, document.currentVersionId, 'documentVersion')

  return db.insert(rateConfirmationAcceptances, {
    loadId: input.loadId,
    carrierId: load.carrierId,
    documentId: document.id,
    documentVersionId: version.id,
    decision: input.decision,
    decisionReason: input.reason ?? null,
    actorUserId: actor.userId,
    documentSha256: version.sha256,
    ratedAmountCents: load.carrierGrossRateCents,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
  })
}

/* ── Stop management ─────────────────────────────────────────────────────── */

export interface AddStopInput {
  loadId: string
  stopType: 'pickup' | 'delivery'
  /** 1-based; omit to append. */
  sequence?: number
  facilityName?: string | null
  customerLocationId?: string | null
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  placeId?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  confirmationNumber?: string | null
  instructions?: string | null
  appointmentType: 'exact' | 'window' | 'fcfs' | 'open'
  windowStart?: Date | null
  windowEnd?: Date | null
}

export async function addStop(db: TenantDb, _actor: { userId: string }, input: AddStopInput): Promise<LoadStop> {
  await db.requireById(loads, input.loadId, 'load')
  const existingStops = await db.findMany(loadStops, {
    where: eq(loadStops.loadId, input.loadId),
    orderBy: asc(loadStops.sequence),
  })
  const sequence = Math.min(Math.max(1, input.sequence ?? existingStops.length + 1), existingStops.length + 1)
  const geo = await resolveStopGeo(input)

  return db.transaction(async (tx) => {
    for (const stop of existingStops.filter((s) => s.sequence >= sequence).sort((a, b) => b.sequence - a.sequence)) {
      await tx.update(loadStops, stop.id, { sequence: stop.sequence + 1 })
    }
    return tx.insert(loadStops, {
      loadId: input.loadId,
      stopType: input.stopType,
      sequence,
      facilityName: input.facilityName ?? null,
      customerLocationId: input.customerLocationId ?? null,
      line1: input.line1 ?? null,
      line2: input.line2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      placeId: geo.placeId,
      latitude: geo.latitude,
      longitude: geo.longitude,
      timezone: geo.timezone,
      contactName: input.contactName ?? null,
      contactPhone: input.contactPhone ?? null,
      contactEmail: input.contactEmail ?? null,
      confirmationNumber: input.confirmationNumber ?? null,
      instructions: input.instructions ?? null,
      appointmentType: input.appointmentType,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
    })
  })
}

/**
 * Reorders every stop on a load to match `orderedStopIds` exactly. Renumbers
 * through a temporary offset first so no intermediate state collides with
 * the `(loadId, sequence)` unique index while the new order is not yet fully
 * written.
 */
export async function reorderStops(
  db: TenantDb,
  _actor: { userId: string },
  loadId: string,
  orderedStopIds: string[],
): Promise<LoadStop[]> {
  const stops = await db.findMany(loadStops, { where: eq(loadStops.loadId, loadId) })
  const stopIds = new Set(stops.map((s) => s.id))
  if (stops.length !== orderedStopIds.length || !orderedStopIds.every((id) => stopIds.has(id))) {
    throw new AppError('validation_failed', 'load.errors.stopSequenceMismatch')
  }

  return db.transaction(async (tx) => {
    for (const stop of stops) {
      await tx.update(loadStops, stop.id, { sequence: stop.sequence + 1000 })
    }
    const updated: LoadStop[] = []
    for (let index = 0; index < orderedStopIds.length; index += 1) {
      const row = await tx.update(loadStops, orderedStopIds[index]!, { sequence: index + 1 })
      if (row) updated.push(row)
    }
    return updated.sort((a, b) => a.sequence - b.sequence)
  })
}

/** Soft-deletes one stop and closes the sequence gap left behind. */
export async function removeStop(db: TenantDb, actor: { userId: string }, loadId: string, stopId: string): Promise<LoadStop[]> {
  await db.requireById(loadStops, stopId, 'loadStop')

  return db.transaction(async (tx) => {
    // `load_stops_load_sequence_uq` is a plain unique index with no partial
    // `WHERE deleted_at IS NULL` clause, so a soft-deleted row keeps occupying
    // its sequence slot forever unless we move it out of the way here. Evacuate
    // it below the lowest sequence in use (deleted rows included) so the
    // gap-closing renumber below — and any future addStop/reorderStops on this
    // load — can never collide with it.
    const allForLoad = await tx.findMany(loadStops, { where: eq(loadStops.loadId, loadId), includeDeleted: true })
    const lowestSequence = Math.min(0, ...allForLoad.map((s) => s.sequence))
    await tx.update(loadStops, stopId, { sequence: lowestSequence - 1 })
    await tx.softDelete(loadStops, stopId, actor.userId)
    const remaining = await tx.findMany(loadStops, {
      where: eq(loadStops.loadId, loadId),
      orderBy: asc(loadStops.sequence),
    })

    const renumbered: LoadStop[] = []
    for (let index = 0; index < remaining.length; index += 1) {
      const target = index + 1
      const current = remaining[index]!
      if (current.sequence === target) {
        renumbered.push(current)
      } else {
        const updated = await tx.update(loadStops, current.id, { sequence: target })
        renumbered.push(updated ?? current)
      }
    }
    return renumbered
  })
}

export async function recordStopArrival(
  db: TenantDb,
  _actor: { userId: string },
  input: { stopId: string; arrivedAt: Date },
): Promise<LoadStop> {
  const updated = await db.update(loadStops, input.stopId, { actualArrivalAt: input.arrivedAt })
  if (!updated) throw notFound('errors.notFound', { entity: 'loadStop' })
  return updated
}

export async function recordStopDeparture(
  db: TenantDb,
  _actor: { userId: string },
  input: { stopId: string; departedAt: Date; detentionNotes?: string | null },
): Promise<LoadStop> {
  const stop = await db.requireById(loadStops, input.stopId, 'loadStop')
  if (!stop.actualArrivalAt) {
    throw new AppError('validation_failed', 'load.errors.arrivalRequiredBeforeDeparture')
  }
  const detentionMinutes = calculateDetentionMinutes(stop.actualArrivalAt, input.departedAt)
  const updated = await db.update(loadStops, input.stopId, {
    actualDepartureAt: input.departedAt,
    detentionMinutes,
    detentionNotes: input.detentionNotes ?? stop.detentionNotes ?? null,
  })
  if (!updated) throw notFound('errors.notFound', { entity: 'loadStop' })
  return updated
}

/* ── Check calls ─────────────────────────────────────────────────────────── */

export async function scheduleCheckCall(
  db: TenantDb,
  _actor: { userId: string },
  input: { loadId: string; scheduledFor: Date; notes?: string | null },
): Promise<CheckCall> {
  await db.requireById(loads, input.loadId, 'load')
  return db.insert(checkCalls, {
    loadId: input.loadId,
    scheduledFor: input.scheduledFor,
    origin: 'scheduled',
    notes: input.notes ?? null,
  })
}

export async function completeCheckCall(
  db: TenantDb,
  actor: { userId: string },
  input: { checkCallId: string; notes?: string | null; locationSummary?: string | null },
): Promise<CheckCall> {
  await db.requireById(checkCalls, input.checkCallId, 'checkCall')
  const updated = await db.update(checkCalls, input.checkCallId, {
    completedAt: new Date(),
    completedByUserId: actor.userId,
    notes: input.notes ?? undefined,
    locationSummary: input.locationSummary ?? undefined,
  })
  if (!updated) throw notFound('errors.notFound', { entity: 'checkCall' })
  return updated
}

export async function listDueCheckCalls(db: TenantDb, withinHours = 24): Promise<CheckCall[]> {
  const cutoff = new Date(Date.now() + withinHours * 60 * 60 * 1000)
  return db.findMany(checkCalls, {
    where: and(isNull(checkCalls.completedAt), lte(checkCalls.scheduledFor, cutoff))!,
    orderBy: asc(checkCalls.scheduledFor),
  })
}
