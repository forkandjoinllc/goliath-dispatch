import 'server-only'
import { and, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  carrierOnboardings,
  carriers,
  documents,
  driverCarrierRelationships,
  drivers,
  equipmentVerifications,
  escorts,
  loadAssignments,
  loads,
  oversizeEvaluations,
  permits,
  trailers,
  trucks,
  userTenantMemberships,
  type Load,
  type OversizeEvaluation,
} from '@/db/schema'
import type { EquipmentType } from '@/server/verification/equipment-verification'
import { fullName } from '@/lib/utils'
import {
  carrierGate,
  driverGate,
  equipmentGate,
  oversizeGate,
  permitGate,
  scheduleGate,
  type CarrierGateInput,
} from './gates'
import { mergeComplianceResults, toComplianceResult, type ComplianceResult } from './types'

/**
 * Loader functions.
 *
 * Each `evaluate*` gathers exactly the data its gate needs — one round trip
 * per gate wherever the query shape allows it — and then hands that data to
 * the pure predicate in `gates.ts`. No business rule lives here; this file is
 * plumbing between the database and the gate.
 */

/** Used only when a carrier somehow has no onboarding row yet. */
const DEFAULT_REQUIRED_DOCUMENT_TYPES = ['certificate_of_authority', 'certificate_of_insurance', 'w9']

async function loadCarrierGateInput(
  db: TenantDb,
  carrierId: string,
  overrides: Partial<CarrierGateInput> = {},
): Promise<CarrierGateInput> {
  const carrier = await db.requireById(carriers, carrierId, 'carrier')
  const onboarding = await db.findFirst(carrierOnboardings, {
    where: eq(carrierOnboardings.carrierId, carrierId),
  })
  const requiredTypes = onboarding?.requiredDocumentTypes?.length
    ? onboarding.requiredDocumentTypes
    : DEFAULT_REQUIRED_DOCUMENT_TYPES

  const ownedDocuments = await db.findMany(documents, {
    where: and(eq(documents.ownerType, 'carrier'), eq(documents.ownerId, carrierId))!,
    orderBy: desc(documents.createdAt),
  })

  const requiredDocuments = requiredTypes.map((documentType) => {
    const match = ownedDocuments.find((doc) => doc.documentType === documentType)
    return {
      documentType,
      present: !!match,
      reviewStatus: match?.reviewStatus ?? null,
      expirationDate: match?.expirationDate ?? null,
    }
  })

  return {
    onboardingStatus: carrier.onboardingStatus,
    suspendedAt: carrier.suspendedAt,
    fmcsaStatus: carrier.fmcsaStatus,
    fmcsaNextVerificationAt: carrier.fmcsaNextVerificationAt,
    requiredDocuments,
    ...overrides,
  }
}

/** The full carrier gate — used to decide whether an already-approved carrier may receive load assignments. */
export async function evaluateCarrier(db: TenantDb, carrierId: string): Promise<ComplianceResult> {
  return carrierGate(await loadCarrierGateInput(db, carrierId))
}

/**
 * The same gate, evaluated as if onboarding were already approved. Used by
 * `approveOnboarding` itself, which would otherwise always fail its own
 * "onboarding approved" check — that condition describes the transition
 * being decided, not a fact to gate the decision on. Every other blocking
 * reason (missing documents, unverified FMCSA) still applies.
 */
export async function evaluateCarrierReadinessForApproval(db: TenantDb, carrierId: string): Promise<ComplianceResult> {
  return carrierGate(await loadCarrierGateInput(db, carrierId, { onboardingStatus: 'approved' }))
}

export interface EvaluateEquipmentInput {
  equipmentType: EquipmentType
  equipmentId: string
}

export async function evaluateEquipmentForLoad(
  db: TenantDb,
  input: EvaluateEquipmentInput,
): Promise<ComplianceResult> {
  const table = input.equipmentType === 'truck' ? trucks : trailers
  const equipment = await db.requireById(table, input.equipmentId, input.equipmentType)

  const verification = await db.findFirst(equipmentVerifications, {
    where: and(
      eq(equipmentVerifications.equipmentType, input.equipmentType),
      eq(equipmentVerifications.equipmentId, input.equipmentId),
    )!,
    orderBy: desc(equipmentVerifications.createdAt),
  })

  let coiExpiresAt: Date | null = null
  if (verification?.coiDocumentId) {
    const coiDoc = await db.findById(documents, verification.coiDocumentId)
    coiExpiresAt = coiDoc?.expirationDate ?? null
  }

  return equipmentGate({
    equipmentType: input.equipmentType,
    status: equipment.status,
    verification: verification
      ? {
          status: verification.status,
          blockingReasons: verification.blockingReasons,
          vin: equipment.vinNormalized,
          coiExpiresAt,
        }
      : null,
    mediaApprovedCount: verification?.mediaCount ?? 0,
    registrationExpiresAt: equipment.registrationExpiresAt,
    nextInspectionDueAt: equipment.nextInspectionDueAt,
  })
}

export interface EvaluateDriverInput {
  driverId: string
  carrierId: string
}

export async function evaluateDriverForLoad(db: TenantDb, input: EvaluateDriverInput): Promise<ComplianceResult> {
  const driver = await db.requireById(drivers, input.driverId, 'driver')
  const now = new Date()

  const hasActiveCarrierRelationship = await db.exists(
    driverCarrierRelationships,
    and(
      eq(driverCarrierRelationships.driverId, input.driverId),
      eq(driverCarrierRelationships.carrierId, input.carrierId),
      or(isNull(driverCarrierRelationships.endDate), gt(driverCarrierRelationships.endDate, now))!,
    )!,
  )

  return driverGate({
    verificationStatus: driver.verificationStatus,
    licenseExpiresAt: driver.licenseExpiresAt,
    medicalCardExpiresAt: driver.medicalCardExpiresAt,
    status: driver.status,
    hasActiveCarrierRelationship,
  })
}

interface ScheduleLookupInput {
  resourceType: 'truck' | 'trailer' | 'driver'
  resourceId: string
  excludeLoadId: string
  candidateWindow: { from: Date; to: Date }
}

/**
 * `scheduleGate`'s `errors.schedulingConflict` message reads `"{resource} is
 * already committed to load {loadNumber} ..."` — it needs a human-facing
 * label (unit number or driver name), not the bare resource id. Falls back
 * to the id only if the row has somehow already been deleted out from under
 * an in-flight evaluation, so the message still renders instead of throwing.
 */
async function resolveResourceLabel(
  db: TenantDb,
  resourceType: 'truck' | 'trailer' | 'driver',
  resourceId: string,
): Promise<string> {
  if (resourceType === 'driver') {
    const driver = await db.findById(drivers, resourceId)
    return driver ? fullName(driver) || resourceId : resourceId
  }
  const table = resourceType === 'truck' ? trucks : trailers
  const equipment = await db.findById(table, resourceId)
  return equipment?.unitNumber ?? resourceId
}

async function evaluateScheduleForResource(db: TenantDb, input: ScheduleLookupInput): Promise<ComplianceResult> {
  const column =
    input.resourceType === 'truck'
      ? loadAssignments.truckId
      : input.resourceType === 'trailer'
        ? loadAssignments.trailerId
        : loadAssignments.driverId

  const assignments = await db.findMany(loadAssignments, {
    where: and(
      eq(column, input.resourceId),
      isNull(loadAssignments.unassignedAt),
      ne(loadAssignments.loadId, input.excludeLoadId),
    )!,
  })

  if (assignments.length === 0) {
    // No other active assignment for this resource — `scheduleGate` can
    // never produce a reason to report, so `resourceLabel` is dead in this
    // branch and not worth an extra lookup for.
    return scheduleGate({
      resourceType: input.resourceType,
      resourceLabel: input.resourceId,
      candidateWindow: input.candidateWindow,
      existingCommitments: [],
    })
  }

  const loadIds = [...new Set(assignments.map((a) => a.loadId))]
  const relatedLoads = await db.findMany(loads, { where: inArray(loads.id, loadIds) })
  const loadNumberById = new Map(relatedLoads.map((l) => [l.id, l.loadNumber]))

  return scheduleGate({
    resourceType: input.resourceType,
    resourceLabel: await resolveResourceLabel(db, input.resourceType, input.resourceId),
    candidateWindow: input.candidateWindow,
    existingCommitments: assignments.map((a) => ({
      loadNumber: loadNumberById.get(a.loadId) ?? a.loadId,
      committedFrom: a.committedFrom,
      committedTo: a.committedTo,
    })),
  })
}

export interface AssignmentCandidateResource {
  type: 'truck' | 'trailer' | 'driver'
  id: string
}

/** Whether a specific truck/trailer/driver may be assigned to this load right now. */
export async function evaluateAssignmentCandidate(
  db: TenantDb,
  loadId: string,
  resource: AssignmentCandidateResource,
): Promise<ComplianceResult> {
  const load = await db.requireById(loads, loadId, 'load')
  const candidateWindow = {
    from: load.plannedPickupAt ?? new Date(),
    to: load.plannedDeliveryAt ?? load.plannedPickupAt ?? new Date(),
  }

  const [resourceResult, scheduleResult] = await Promise.all([
    resource.type === 'driver'
      ? evaluateDriverForLoad(db, { driverId: resource.id, carrierId: load.carrierId ?? '' })
      : evaluateEquipmentForLoad(db, { equipmentType: resource.type, equipmentId: resource.id }),
    evaluateScheduleForResource(db, {
      resourceType: resource.type,
      resourceId: resource.id,
      excludeLoadId: loadId,
      candidateWindow,
    }),
  ])

  return mergeComplianceResults([resourceResult, scheduleResult])
}

function isEvaluationCurrentForLoad(evaluation: OversizeEvaluation, load: Load): boolean {
  const inputs = evaluation.inputs as Record<string, unknown>
  return (
    inputs.weightPounds === load.weightPounds &&
    inputs.lengthInches === load.lengthInches &&
    inputs.widthInches === load.widthInches &&
    inputs.heightInches === load.heightInches
  )
}

/** The composite gate checked before a load may leave `assigned`/`dispatched`. */
export async function evaluateLoadForDispatch(db: TenantDb, loadId: string): Promise<ComplianceResult> {
  const load = await db.requireById(loads, loadId, 'load')

  const [carrierResult, assignments, oversizeEvaluation, permitRows, escortRows] = await Promise.all([
    load.carrierId ? evaluateCarrier(db, load.carrierId) : Promise.resolve(toComplianceResult([])),
    db.findMany(loadAssignments, {
      where: and(eq(loadAssignments.loadId, loadId), isNull(loadAssignments.unassignedAt))!,
    }),
    db.findFirst(oversizeEvaluations, {
      where: eq(oversizeEvaluations.loadId, loadId),
      orderBy: desc(oversizeEvaluations.evaluatedAt),
    }),
    db.findMany(permits, { where: and(eq(permits.loadId, loadId), ne(permits.status, 'not_required'))! }),
    db.findMany(escorts, { where: and(eq(escorts.loadId, loadId), ne(escorts.status, 'not_required'))! }),
  ])

  const resourceResults: ComplianceResult[] = []
  const scheduleResults: ComplianceResult[] = []

  for (const assignment of assignments) {
    const window = {
      from: assignment.committedFrom ?? load.plannedPickupAt ?? new Date(),
      to: assignment.committedTo ?? load.plannedDeliveryAt ?? load.plannedPickupAt ?? new Date(),
    }

    if (assignment.truckId) {
      resourceResults.push(await evaluateEquipmentForLoad(db, { equipmentType: 'truck', equipmentId: assignment.truckId }))
      scheduleResults.push(
        await evaluateScheduleForResource(db, {
          resourceType: 'truck',
          resourceId: assignment.truckId,
          excludeLoadId: loadId,
          candidateWindow: window,
        }),
      )
    }
    if (assignment.trailerId) {
      resourceResults.push(
        await evaluateEquipmentForLoad(db, { equipmentType: 'trailer', equipmentId: assignment.trailerId }),
      )
      scheduleResults.push(
        await evaluateScheduleForResource(db, {
          resourceType: 'trailer',
          resourceId: assignment.trailerId,
          excludeLoadId: loadId,
          candidateWindow: window,
        }),
      )
    }
    if (assignment.driverId && load.carrierId) {
      resourceResults.push(
        await evaluateDriverForLoad(db, { driverId: assignment.driverId, carrierId: load.carrierId }),
      )
      scheduleResults.push(
        await evaluateScheduleForResource(db, {
          resourceType: 'driver',
          resourceId: assignment.driverId,
          excludeLoadId: loadId,
          candidateWindow: window,
        }),
      )
    }
  }

  let oversizeResult: ComplianceResult = toComplianceResult([])
  if (load.isOversize || load.isOverweight) {
    let validatedByAdmin = false
    if (oversizeEvaluation?.validatedByUserId) {
      const membership = await db.findFirst(userTenantMemberships, {
        where: eq(userTenantMemberships.userId, oversizeEvaluation.validatedByUserId),
      })
      validatedByAdmin = membership?.role === 'admin'
    }

    oversizeResult = oversizeGate({
      requiresOversizeEvaluation: true,
      evaluation: oversizeEvaluation
        ? {
            exists: true,
            isCurrentForDimensions: isEvaluationCurrentForLoad(oversizeEvaluation, load),
            humanValidationStatus: oversizeEvaluation.humanValidationStatus,
            validatedByAdmin,
          }
        : null,
    })
  }

  const permitResult = permitGate({
    requiredPermitStates: permitRows.map((p) => ({
      stateCode: p.stateCode,
      permit: { status: p.status, expiresAt: p.expiresAt },
    })),
    requiredEscorts: escortRows.map((e) => ({ escortType: e.escortType, status: e.status })),
  })

  return mergeComplianceResults([
    carrierResult,
    ...resourceResults,
    ...scheduleResults,
    oversizeResult,
    permitResult,
  ])
}
