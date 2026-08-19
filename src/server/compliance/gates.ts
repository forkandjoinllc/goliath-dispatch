import { MINIMUM_EQUIPMENT_MEDIA } from '@/server/verification/equipment-verification'
import {
  blockingReason,
  mergeComplianceResults,
  toComplianceResult,
  type ComplianceReason,
  type ComplianceResult,
} from './types'

/**
 * Pure compliance predicates.
 *
 * Every gate here takes data that has already been loaded by `service.ts` —
 * no gate opens a database connection, calls an integration, or throws. That
 * is what makes each one exhaustively unit-testable against hand-built
 * fixtures (see `tests/unit/compliance/`) and safe to call from a render
 * path as often as needed.
 */

const VERIFICATION_PASS_STATUSES = new Set(['verified', 'manually_overridden'])

function isExpired(date: Date | null | undefined, now: Date): boolean {
  return !date || date.getTime() <= now.getTime()
}

/* ── Carrier ─────────────────────────────────────────────────────────────── */

export interface CarrierRequiredDocument {
  documentType: string
  present: boolean
  reviewStatus: string | null
  expirationDate: Date | null
}

export interface CarrierGateInput {
  onboardingStatus: string
  suspendedAt: Date | null
  fmcsaStatus: string
  fmcsaNextVerificationAt: Date | null
  requiredDocuments: CarrierRequiredDocument[]
  now?: Date
}

export function carrierGate(input: CarrierGateInput): ComplianceResult {
  const now = input.now ?? new Date()
  const reasons: ComplianceReason[] = []

  if (input.suspendedAt) {
    reasons.push(blockingReason('carrier_suspended', 'carrier.compliance.suspended'))
  }

  if (input.onboardingStatus !== 'approved') {
    reasons.push(
      blockingReason('onboarding_not_approved', 'carrier.compliance.onboardingNotApproved', {
        status: input.onboardingStatus,
      }),
    )
  }

  for (const doc of input.requiredDocuments) {
    if (!doc.present) {
      reasons.push(blockingReason('document_missing', 'errors.documentMissing', { document: doc.documentType }))
    } else if (doc.reviewStatus !== 'approved') {
      reasons.push(
        blockingReason('document_not_approved', 'errors.documentNotApproved', { document: doc.documentType }),
      )
    } else if (doc.expirationDate && doc.expirationDate.getTime() <= now.getTime()) {
      reasons.push(
        blockingReason('document_expired', 'errors.documentExpired', {
          document: doc.documentType,
          date: doc.expirationDate.toISOString(),
        }),
      )
    }
  }

  if (!VERIFICATION_PASS_STATUSES.has(input.fmcsaStatus)) {
    reasons.push(blockingReason('fmcsa_not_verified', 'carrier.compliance.fmcsaNotVerified'))
  } else if (isExpired(input.fmcsaNextVerificationAt, now)) {
    reasons.push(
      blockingReason('fmcsa_stale', 'carrier.compliance.fmcsaStale', {
        date: input.fmcsaNextVerificationAt?.toISOString() ?? '',
      }),
    )
  }

  return toComplianceResult(reasons)
}

/* ── Equipment ───────────────────────────────────────────────────────────── */

export interface EquipmentVerificationSnapshot {
  status: string
  /** Codes from `equipmentVerifications.blockingReasons` — see equipment-verification.ts. */
  blockingReasons: string[]
  vin?: string | null
  coiExpiresAt?: Date | null
}

export interface EquipmentGateInput {
  equipmentType: 'truck' | 'trailer'
  status: string
  verification: EquipmentVerificationSnapshot | null
  mediaApprovedCount: number
  registrationExpiresAt: Date | null
  nextInspectionDueAt: Date | null
  now?: Date
}

function equipmentVerificationReason(
  code: string,
  snapshot: EquipmentVerificationSnapshot,
): ComplianceReason | null {
  switch (code) {
    case 'vin_not_on_coi':
      return blockingReason('vin_not_on_coi', 'errors.vinNotOnCoi', { vin: snapshot.vin ?? '' })
    case 'no_approved_coi':
      return blockingReason('no_approved_coi', 'carrier.compliance.noApprovedCoi')
    case 'coi_expired':
      return blockingReason('coi_expired', 'carrier.compliance.coiExpired', {
        date: snapshot.coiExpiresAt?.toISOString() ?? '',
      })
    case 'ocr_failed':
      return blockingReason('ocr_failed', 'carrier.compliance.ocrFailed')
    case 'insufficient_media':
      // Surfaced independently below from the caller-supplied media count, so
      // the exact `{required, provided}` figures are always in the message.
      return null
    default:
      return blockingReason(code, 'carrier.compliance.coiNotVerified')
  }
}

export function equipmentGate(input: EquipmentGateInput): ComplianceResult {
  const now = input.now ?? new Date()
  const reasons: ComplianceReason[] = []

  if (input.status !== 'active') {
    reasons.push(
      blockingReason('equipment_inactive', 'carrier.compliance.equipmentInactive', { status: input.status }),
    )
  }

  if (!input.verification) {
    reasons.push(blockingReason('no_approved_coi', 'carrier.compliance.noApprovedCoi'))
  } else if (!VERIFICATION_PASS_STATUSES.has(input.verification.status)) {
    const mapped = input.verification.blockingReasons
      .map((code) => equipmentVerificationReason(code, input.verification!))
      .filter((r): r is ComplianceReason => r !== null)
    if (mapped.length > 0) {
      reasons.push(...mapped)
    } else {
      reasons.push(blockingReason('coi_not_verified', 'carrier.compliance.coiNotVerified'))
    }
  }

  if (input.mediaApprovedCount < MINIMUM_EQUIPMENT_MEDIA) {
    reasons.push(
      blockingReason('insufficient_media', 'errors.insufficientMedia', {
        required: MINIMUM_EQUIPMENT_MEDIA,
        provided: input.mediaApprovedCount,
      }),
    )
  }

  if (input.registrationExpiresAt && input.registrationExpiresAt.getTime() <= now.getTime()) {
    reasons.push(
      blockingReason('registration_expired', 'carrier.compliance.registrationExpired', {
        date: input.registrationExpiresAt.toISOString(),
      }),
    )
  }

  if (input.nextInspectionDueAt && input.nextInspectionDueAt.getTime() <= now.getTime()) {
    reasons.push(
      blockingReason('inspection_expired', 'carrier.compliance.inspectionExpired', {
        date: input.nextInspectionDueAt.toISOString(),
      }),
    )
  }

  return toComplianceResult(reasons)
}

/* ── Driver ──────────────────────────────────────────────────────────────── */

export interface DriverGateInput {
  verificationStatus: string
  licenseExpiresAt: Date | null
  medicalCardExpiresAt: Date | null
  status: string
  hasActiveCarrierRelationship: boolean
  now?: Date
}

export function driverGate(input: DriverGateInput): ComplianceResult {
  const now = input.now ?? new Date()
  const reasons: ComplianceReason[] = []

  if (!VERIFICATION_PASS_STATUSES.has(input.verificationStatus)) {
    reasons.push(blockingReason('driver_not_approved', 'carrier.compliance.driverNotApproved'))
  }

  if (!input.licenseExpiresAt) {
    reasons.push(blockingReason('license_missing', 'carrier.compliance.driverLicenseMissing'))
  } else if (isExpired(input.licenseExpiresAt, now)) {
    reasons.push(
      blockingReason('license_expired', 'carrier.compliance.driverLicenseExpired', {
        date: input.licenseExpiresAt.toISOString(),
      }),
    )
  }

  if (!input.medicalCardExpiresAt) {
    reasons.push(blockingReason('medical_card_missing', 'carrier.compliance.driverMedicalCardMissing'))
  } else if (isExpired(input.medicalCardExpiresAt, now)) {
    reasons.push(
      blockingReason('medical_card_expired', 'carrier.compliance.driverMedicalCardExpired', {
        date: input.medicalCardExpiresAt.toISOString(),
      }),
    )
  }

  if (input.status === 'inactive') {
    reasons.push(blockingReason('driver_inactive', 'carrier.compliance.driverInactive'))
  }

  if (!input.hasActiveCarrierRelationship) {
    reasons.push(blockingReason('driver_no_carrier_relationship', 'carrier.compliance.driverNoCarrierRelationship'))
  }

  return toComplianceResult(reasons)
}

/* ── Schedule ────────────────────────────────────────────────────────────── */

export interface ScheduleCommitment {
  loadNumber: string
  committedFrom: Date | null
  committedTo: Date | null
}

export interface ScheduleGateInput {
  resourceType: 'truck' | 'trailer' | 'driver'
  /** Human-facing label for the `{resource}` param — unit number or driver name. */
  resourceLabel: string
  candidateWindow: { from: Date; to: Date }
  existingCommitments: ScheduleCommitment[]
}

function windowsOverlap(aFrom: Date, aTo: Date, bFrom: Date, bTo: Date): boolean {
  return aFrom.getTime() < bTo.getTime() && bFrom.getTime() < aTo.getTime()
}

export function scheduleGate(input: ScheduleGateInput): ComplianceResult {
  const reasons: ComplianceReason[] = []

  for (const commitment of input.existingCommitments) {
    if (!commitment.committedFrom || !commitment.committedTo) continue
    if (
      windowsOverlap(
        input.candidateWindow.from,
        input.candidateWindow.to,
        commitment.committedFrom,
        commitment.committedTo,
      )
    ) {
      reasons.push(
        blockingReason('scheduling_conflict', 'errors.schedulingConflict', {
          resource: input.resourceLabel,
          loadNumber: commitment.loadNumber,
        }),
      )
    }
  }

  return toComplianceResult(reasons)
}

/* ── Oversize ────────────────────────────────────────────────────────────── */

export interface OversizeEvaluationSnapshot {
  exists: boolean
  /** False when the load's current dimensions differ from what was evaluated. */
  isCurrentForDimensions: boolean
  humanValidationStatus: string
  validatedByAdmin: boolean
}

export interface OversizeGateInput {
  requiresOversizeEvaluation: boolean
  evaluation: OversizeEvaluationSnapshot | null
}

export function oversizeGate(input: OversizeGateInput): ComplianceResult {
  if (!input.requiresOversizeEvaluation) return toComplianceResult([])

  const reasons: ComplianceReason[] = []

  if (!input.evaluation || !input.evaluation.exists) {
    reasons.push(blockingReason('oversize_evaluation_missing', 'carrier.compliance.oversizeEvaluationMissing'))
    return toComplianceResult(reasons)
  }

  if (!input.evaluation.isCurrentForDimensions) {
    reasons.push(blockingReason('oversize_evaluation_stale', 'carrier.compliance.oversizeEvaluationStale'))
  }

  if (input.evaluation.humanValidationStatus !== 'validated' || !input.evaluation.validatedByAdmin) {
    reasons.push(blockingReason('oversize_not_validated', 'errors.oversizeNotValidated'))
  }

  return toComplianceResult(reasons)
}

/* ── Permits & escorts ───────────────────────────────────────────────────── */

export interface RequiredPermitState {
  stateCode: string
  permit: { status: string; expiresAt: Date | null } | null
}

export interface RequiredEscort {
  escortType: string
  status: string
}

export interface PermitGateInput {
  requiredPermitStates: RequiredPermitState[]
  requiredEscorts: RequiredEscort[]
  now?: Date
}

export function permitGate(input: PermitGateInput): ComplianceResult {
  const now = input.now ?? new Date()
  const reasons: ComplianceReason[] = []

  for (const required of input.requiredPermitStates) {
    const permit = required.permit
    const issuedAndCurrent =
      !!permit && permit.status === 'issued' && (!permit.expiresAt || permit.expiresAt.getTime() > now.getTime())
    if (!issuedAndCurrent) {
      reasons.push(blockingReason('permit_missing', 'errors.permitMissing', { state: required.stateCode }))
    }
  }

  for (const escort of input.requiredEscorts) {
    if (escort.status !== 'confirmed') {
      reasons.push(
        blockingReason('escort_not_confirmed', 'errors.escortMissing', { escortType: escort.escortType }),
      )
    }
  }

  return toComplianceResult(reasons)
}

/* ── Dispatch (composite) ────────────────────────────────────────────────── */

export interface DispatchGateInput {
  carrier: CarrierGateInput
  equipment: EquipmentGateInput[]
  drivers: DriverGateInput[]
  schedules: ScheduleGateInput[]
  oversize: OversizeGateInput
  permit: PermitGateInput
}

/**
 * The composite gate checked before a load may leave `assigned`/`dispatched`.
 * Every sub-gate has already been unit-tested in isolation; this function's
 * own tests focus on the merge — e.g. one blocking equipment reason must not
 * be hidden by an otherwise-clean carrier.
 */
export function dispatchGate(input: DispatchGateInput): ComplianceResult {
  return mergeComplianceResults([
    carrierGate(input.carrier),
    ...input.equipment.map((e) => equipmentGate(e)),
    ...input.drivers.map((d) => driverGate(d)),
    ...input.schedules.map((s) => scheduleGate(s)),
    oversizeGate(input.oversize),
    permitGate(input.permit),
  ])
}
