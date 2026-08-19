import { describe, expect, it } from 'vitest'
import {
  carrierGate,
  driverGate,
  equipmentGate,
  oversizeGate,
  permitGate,
  scheduleGate,
  dispatchGate,
  type CarrierGateInput,
  type DispatchGateInput,
  type DriverGateInput,
  type EquipmentGateInput,
} from '@/server/compliance/gates'
import { MINIMUM_EQUIPMENT_MEDIA } from '@/server/verification/equipment-verification'

const NOW = new Date('2026-06-01T00:00:00Z')
const PAST = new Date('2026-01-01T00:00:00Z')
const FUTURE = new Date('2026-12-01T00:00:00Z')

function baseCarrierInput(overrides: Partial<CarrierGateInput> = {}): CarrierGateInput {
  return {
    onboardingStatus: 'approved',
    suspendedAt: null,
    fmcsaStatus: 'verified',
    fmcsaNextVerificationAt: FUTURE,
    requiredDocuments: [
      { documentType: 'certificate_of_authority', present: true, reviewStatus: 'approved', expirationDate: null },
      { documentType: 'certificate_of_insurance', present: true, reviewStatus: 'approved', expirationDate: FUTURE },
      { documentType: 'w9', present: true, reviewStatus: 'approved', expirationDate: null },
    ],
    now: NOW,
    ...overrides,
  }
}

describe('carrierGate', () => {
  it('passes a fully compliant carrier', () => {
    const result = carrierGate(baseCarrierInput())
    expect(result.ok).toBe(true)
    expect(result.blocking).toHaveLength(0)
  })

  it('blocks when onboarding is not approved', () => {
    const result = carrierGate(baseCarrierInput({ onboardingStatus: 'under_review' }))
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('onboarding_not_approved')
  })

  it('blocks when the carrier is suspended', () => {
    const result = carrierGate(baseCarrierInput({ suspendedAt: PAST }))
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('carrier_suspended')
  })

  it('blocks when a required document is missing', () => {
    const result = carrierGate(
      baseCarrierInput({
        requiredDocuments: [
          { documentType: 'certificate_of_authority', present: false, reviewStatus: null, expirationDate: null },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    const reason = result.blocking.find((r) => r.code === 'document_missing')
    expect(reason?.messageKey).toBe('errors.documentMissing')
    expect(reason?.params?.document).toBe('certificate_of_authority')
  })

  it('blocks when a required document has expired', () => {
    const result = carrierGate(
      baseCarrierInput({
        requiredDocuments: [
          {
            documentType: 'certificate_of_insurance',
            present: true,
            reviewStatus: 'approved',
            expirationDate: PAST,
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('document_expired')
  })

  it('blocks when FMCSA has never been verified', () => {
    const result = carrierGate(baseCarrierInput({ fmcsaStatus: 'not_started', fmcsaNextVerificationAt: null }))
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('fmcsa_not_verified')
  })

  it('blocks when the FMCSA verification is stale even though it was once verified', () => {
    const result = carrierGate(baseCarrierInput({ fmcsaStatus: 'verified', fmcsaNextVerificationAt: PAST }))
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('fmcsa_stale')
  })

  it('passes when FMCSA was manually overridden and the override is not stale', () => {
    const result = carrierGate(baseCarrierInput({ fmcsaStatus: 'manually_overridden', fmcsaNextVerificationAt: FUTURE }))
    expect(result.ok).toBe(true)
  })

  it('blocks when a manual override has itself gone stale', () => {
    const result = carrierGate(baseCarrierInput({ fmcsaStatus: 'manually_overridden', fmcsaNextVerificationAt: PAST }))
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('fmcsa_stale')
  })
})

describe('equipmentGate', () => {
  function baseEquipmentInput(overrides: Partial<EquipmentGateInput> = {}): EquipmentGateInput {
    return {
      equipmentType: 'trailer',
      status: 'active',
      verification: { status: 'verified', blockingReasons: [] },
      mediaApprovedCount: MINIMUM_EQUIPMENT_MEDIA,
      registrationExpiresAt: FUTURE,
      nextInspectionDueAt: FUTURE,
      now: NOW,
      ...overrides,
    }
  }

  it('passes fully compliant equipment', () => {
    const result = equipmentGate(baseEquipmentInput())
    expect(result.ok).toBe(true)
  })

  it('blocks when the COI has expired', () => {
    const result = equipmentGate(
      baseEquipmentInput({
        verification: {
          status: 'failed',
          blockingReasons: ['coi_expired'],
          coiExpiresAt: PAST,
        },
      }),
    )
    expect(result.ok).toBe(false)
    const reason = result.blocking.find((r) => r.code === 'coi_expired')
    expect(reason).toBeDefined()
    expect(reason?.messageKey).toBe('carrier.compliance.coiExpired')
  })

  it('blocks when the VIN is not on the COI', () => {
    const result = equipmentGate(
      baseEquipmentInput({
        verification: {
          status: 'mismatch',
          blockingReasons: ['vin_not_on_coi'],
          vin: '1FUJGLDR6LLJY0026',
        },
      }),
    )
    expect(result.ok).toBe(false)
    const reason = result.blocking.find((r) => r.code === 'vin_not_on_coi')
    expect(reason?.messageKey).toBe('errors.vinNotOnCoi')
    expect(reason?.params?.vin).toBe('1FUJGLDR6LLJY0026')
  })

  it('blocks with 3 approved photos', () => {
    const result = equipmentGate(baseEquipmentInput({ mediaApprovedCount: 3 }))
    expect(result.ok).toBe(false)
    const reason = result.blocking.find((r) => r.code === 'insufficient_media')
    expect(reason?.params).toEqual({ required: 4, provided: 3 })
  })

  it('passes with exactly 4 approved photos', () => {
    const result = equipmentGate(baseEquipmentInput({ mediaApprovedCount: 4 }))
    expect(result.blocking.some((r) => r.code === 'insufficient_media')).toBe(false)
  })

  it('blocks when there is no approved COI at all', () => {
    const result = equipmentGate(baseEquipmentInput({ verification: null }))
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('no_approved_coi')
  })

  it('blocks when equipment is not active', () => {
    const result = equipmentGate(baseEquipmentInput({ status: 'out_of_service' }))
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('equipment_inactive')
  })

  it('blocks when registration has expired', () => {
    const result = equipmentGate(baseEquipmentInput({ registrationExpiresAt: PAST }))
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('registration_expired')
  })

  it('blocks when the annual inspection has expired', () => {
    const result = equipmentGate(baseEquipmentInput({ nextInspectionDueAt: PAST }))
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('inspection_expired')
  })

  it('passes when the COI/VIN mismatch has been manually overridden', () => {
    const result = equipmentGate(
      baseEquipmentInput({
        verification: { status: 'manually_overridden', blockingReasons: ['vin_not_on_coi'] },
      }),
    )
    expect(result.ok).toBe(true)
  })
})

describe('driverGate', () => {
  function baseDriverInput(overrides: Partial<DriverGateInput> = {}): DriverGateInput {
    return {
      verificationStatus: 'verified',
      licenseExpiresAt: FUTURE,
      medicalCardExpiresAt: FUTURE,
      status: 'available',
      hasActiveCarrierRelationship: true,
      now: NOW,
      ...overrides,
    }
  }

  it('passes a fully compliant driver', () => {
    expect(driverGate(baseDriverInput()).ok).toBe(true)
  })

  it('blocks an unapproved driver', () => {
    const result = driverGate(baseDriverInput({ verificationStatus: 'pending' }))
    expect(result.blocking.map((r) => r.code)).toContain('driver_not_approved')
  })

  it('blocks an expired license', () => {
    const result = driverGate(baseDriverInput({ licenseExpiresAt: PAST }))
    expect(result.blocking.map((r) => r.code)).toContain('license_expired')
  })

  it('blocks a missing license', () => {
    const result = driverGate(baseDriverInput({ licenseExpiresAt: null }))
    expect(result.blocking.map((r) => r.code)).toContain('license_missing')
  })

  it('blocks an expired medical card', () => {
    const result = driverGate(baseDriverInput({ medicalCardExpiresAt: PAST }))
    expect(result.blocking.map((r) => r.code)).toContain('medical_card_expired')
  })

  it('blocks an inactive driver', () => {
    const result = driverGate(baseDriverInput({ status: 'inactive' }))
    expect(result.blocking.map((r) => r.code)).toContain('driver_inactive')
  })

  it('blocks a driver with no active relationship to the carrier', () => {
    const result = driverGate(baseDriverInput({ hasActiveCarrierRelationship: false }))
    expect(result.blocking.map((r) => r.code)).toContain('driver_no_carrier_relationship')
  })
})

describe('scheduleGate', () => {
  it('blocks an overlapping commitment window', () => {
    const result = scheduleGate({
      resourceType: 'truck',
      resourceLabel: 'Truck 101',
      candidateWindow: { from: new Date('2026-06-10T08:00:00Z'), to: new Date('2026-06-12T08:00:00Z') },
      existingCommitments: [
        {
          loadNumber: 'GD-1001',
          committedFrom: new Date('2026-06-11T00:00:00Z'),
          committedTo: new Date('2026-06-13T00:00:00Z'),
        },
      ],
    })
    expect(result.ok).toBe(false)
    const reason = result.blocking[0]
    expect(reason?.messageKey).toBe('errors.schedulingConflict')
    expect(reason?.params).toEqual({ resource: 'Truck 101', loadNumber: 'GD-1001' })
  })

  it('passes when windows are merely adjacent (touching, not overlapping)', () => {
    const result = scheduleGate({
      resourceType: 'truck',
      resourceLabel: 'Truck 101',
      candidateWindow: { from: new Date('2026-06-10T08:00:00Z'), to: new Date('2026-06-12T08:00:00Z') },
      existingCommitments: [
        {
          loadNumber: 'GD-1001',
          committedFrom: new Date('2026-06-12T08:00:00Z'),
          committedTo: new Date('2026-06-14T08:00:00Z'),
        },
      ],
    })
    expect(result.ok).toBe(true)
  })

  it('passes when there are no existing commitments', () => {
    const result = scheduleGate({
      resourceType: 'driver',
      resourceLabel: 'Jane Doe',
      candidateWindow: { from: NOW, to: FUTURE },
      existingCommitments: [],
    })
    expect(result.ok).toBe(true)
  })

  it('ignores commitments with an incomplete window', () => {
    const result = scheduleGate({
      resourceType: 'trailer',
      resourceLabel: 'Trailer 9',
      candidateWindow: { from: NOW, to: FUTURE },
      existingCommitments: [{ loadNumber: 'GD-2000', committedFrom: null, committedTo: null }],
    })
    expect(result.ok).toBe(true)
  })
})

describe('oversizeGate', () => {
  it('is a no-op when the load is not oversize/overweight', () => {
    const result = oversizeGate({ requiresOversizeEvaluation: false, evaluation: null })
    expect(result.ok).toBe(true)
  })

  it('blocks when no evaluation exists', () => {
    const result = oversizeGate({ requiresOversizeEvaluation: true, evaluation: null })
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('oversize_evaluation_missing')
  })

  it('blocks when the evaluation has not been validated', () => {
    const result = oversizeGate({
      requiresOversizeEvaluation: true,
      evaluation: {
        exists: true,
        isCurrentForDimensions: true,
        humanValidationStatus: 'pending',
        validatedByAdmin: false,
      },
    })
    expect(result.ok).toBe(false)
    const reason = result.blocking.find((r) => r.code === 'oversize_not_validated')
    expect(reason?.messageKey).toBe('errors.oversizeNotValidated')
  })

  it('blocks when validated but not by an admin', () => {
    const result = oversizeGate({
      requiresOversizeEvaluation: true,
      evaluation: {
        exists: true,
        isCurrentForDimensions: true,
        humanValidationStatus: 'validated',
        validatedByAdmin: false,
      },
    })
    expect(result.ok).toBe(false)
  })

  it('blocks a stale evaluation whose dimensions no longer match the load', () => {
    const result = oversizeGate({
      requiresOversizeEvaluation: true,
      evaluation: {
        exists: true,
        isCurrentForDimensions: false,
        humanValidationStatus: 'validated',
        validatedByAdmin: true,
      },
    })
    expect(result.blocking.map((r) => r.code)).toContain('oversize_evaluation_stale')
  })

  it('passes when validated by an admin against current dimensions', () => {
    const result = oversizeGate({
      requiresOversizeEvaluation: true,
      evaluation: {
        exists: true,
        isCurrentForDimensions: true,
        humanValidationStatus: 'validated',
        validatedByAdmin: true,
      },
    })
    expect(result.ok).toBe(true)
  })
})

describe('permitGate', () => {
  it('blocks a missing permit for a required state', () => {
    const result = permitGate({
      requiredPermitStates: [{ stateCode: 'TX', permit: null }],
      requiredEscorts: [],
    })
    expect(result.ok).toBe(false)
    const reason = result.blocking[0]
    expect(reason?.messageKey).toBe('errors.permitMissing')
    expect(reason?.params).toEqual({ state: 'TX' })
  })

  it('blocks an expired permit', () => {
    const result = permitGate({
      requiredPermitStates: [{ stateCode: 'OK', permit: { status: 'issued', expiresAt: PAST } }],
      requiredEscorts: [],
      now: NOW,
    })
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('permit_missing')
  })

  it('passes an issued, unexpired permit', () => {
    const result = permitGate({
      requiredPermitStates: [{ stateCode: 'OK', permit: { status: 'issued', expiresAt: FUTURE } }],
      requiredEscorts: [],
      now: NOW,
    })
    expect(result.ok).toBe(true)
  })

  it('blocks an unconfirmed escort', () => {
    const result = permitGate({
      requiredPermitStates: [],
      requiredEscorts: [{ escortType: 'pilot_car', status: 'pending' }],
    })
    expect(result.ok).toBe(false)
    expect(result.blocking[0]?.messageKey).toBe('errors.escortMissing')
  })

  it('passes a confirmed escort', () => {
    const result = permitGate({
      requiredPermitStates: [],
      requiredEscorts: [{ escortType: 'pilot_car', status: 'confirmed' }],
    })
    expect(result.ok).toBe(true)
  })
})

describe('dispatchGate', () => {
  function compliantDispatchInput(): DispatchGateInput {
    return {
      carrier: baseCarrierInput(),
      equipment: [
        {
          equipmentType: 'truck',
          status: 'active',
          verification: { status: 'verified', blockingReasons: [] },
          mediaApprovedCount: MINIMUM_EQUIPMENT_MEDIA,
          registrationExpiresAt: FUTURE,
          nextInspectionDueAt: FUTURE,
          now: NOW,
        },
      ],
      drivers: [
        {
          verificationStatus: 'verified',
          licenseExpiresAt: FUTURE,
          medicalCardExpiresAt: FUTURE,
          status: 'available',
          hasActiveCarrierRelationship: true,
          now: NOW,
        },
      ],
      schedules: [
        {
          resourceType: 'truck',
          resourceLabel: 'Truck 1',
          candidateWindow: { from: NOW, to: FUTURE },
          existingCommitments: [],
        },
      ],
      oversize: { requiresOversizeEvaluation: false, evaluation: null },
      permit: { requiredPermitStates: [], requiredEscorts: [] },
    }
  }

  it('passes when every sub-gate is clean', () => {
    expect(dispatchGate(compliantDispatchInput()).ok).toBe(true)
  })

  it('surfaces a blocking equipment reason even when the carrier is otherwise clean', () => {
    const input = compliantDispatchInput()
    input.equipment[0]!.mediaApprovedCount = 2
    const result = dispatchGate(input)
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('insufficient_media')
  })

  it('surfaces a scheduling conflict alongside a clean carrier and equipment', () => {
    const input = compliantDispatchInput()
    input.schedules[0]!.existingCommitments = [
      { loadNumber: 'GD-9', committedFrom: NOW, committedTo: FUTURE },
    ]
    const result = dispatchGate(input)
    expect(result.ok).toBe(false)
    expect(result.blocking.map((r) => r.code)).toContain('scheduling_conflict')
  })

  it('aggregates multiple blocking reasons across gates', () => {
    const input = compliantDispatchInput()
    input.carrier.suspendedAt = PAST
    input.drivers[0]!.status = 'inactive'
    const result = dispatchGate(input)
    expect(result.blocking.map((r) => r.code)).toEqual(
      expect.arrayContaining(['carrier_suspended', 'driver_inactive']),
    )
  })
})
