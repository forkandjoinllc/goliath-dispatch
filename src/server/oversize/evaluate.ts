import { encodeGuidanceNote } from './notes'

/**
 * The heavy-haul evaluation engine.
 *
 * `evaluateOversize` is a pure function: no database access, no integration
 * call, no clock read beyond what the caller passes in. It exists so the
 * rules a load must clear are exhaustively unit-testable against hand-built
 * fixtures, exactly like `src/server/compliance/gates.ts`.
 *
 * This is operational guidance, not a legal determination — every value it
 * emits is a translatable key (via `encodeGuidanceNote`) carrying that
 * framing at render time (see `oversize.json`'s `disclaimer` key), and every
 * missing input produces a warning rather than a silent "clear".
 */

export type OversizeOutcome = 'clear' | 'oversize' | 'overweight' | 'oversize_overweight' | 'insufficient_data'

export interface OversizeLoadInputs {
  widthInches: number | null
  heightInches: number | null
  lengthInches: number | null
  /** Gross *vehicle* weight (tractor + trailer + cargo) — compared against each state's legal GVW limit. */
  grossWeightPounds: number | null
  /** Heaviest single axle or axle-group weight, entered at evaluation time. */
  axleWeightPounds: number | null
  axleConfiguration: string | null
}

export interface OversizeTravelRestrictionsInput {
  nightTravelProhibited?: boolean
  weekendTravelProhibited?: boolean
  holidayTravelProhibited?: boolean
  curfewWindows?: Array<{ start: string; end: string; note?: string }>
}

export interface OversizeStateRuleInput {
  stateCode: string
  maxWidthInches: number
  maxHeightInches: number
  maxLengthInches: number
  maxGrossWeightPounds: number
  maxAxleWeightPounds: number
  escortWidthThresholdInches: number | null
  escortHeightThresholdInches: number | null
  escortLengthThresholdInches: number | null
  policeEscortWidthThresholdInches: number | null
  travelRestrictions: OversizeTravelRestrictionsInput
  permitRequiredAboveLegal: boolean
}

export type OversizeDimension = 'width' | 'height' | 'length' | 'grossWeight' | 'axleWeight'

export interface OversizeExceedance {
  dimension: OversizeDimension
  value: number
  limit: number
  unit: 'in' | 'lb'
}

export interface OversizeStateResult {
  stateCode: string
  exceedances: OversizeExceedance[]
  permitRequired: boolean
  escortRequired: boolean
  policeEscortRequired: boolean
  /** Encoded guidance notes — see `./notes.ts`. */
  travelRestrictions: string[]
  /** Encoded guidance notes — see `./notes.ts`. */
  notes: string[]
}

export interface OversizeEvaluationOutput {
  outcome: OversizeOutcome
  permitLikelyRequired: boolean
  escortLikelyRequired: boolean
  policeEscortLikelyRequired: boolean
  stateResults: OversizeStateResult[]
  /** Encoded guidance notes — see `./notes.ts`. */
  missingDataWarnings: string[]
}

function evaluateForState(inputs: OversizeLoadInputs, rule: OversizeStateRuleInput): OversizeStateResult {
  const exceedances: OversizeExceedance[] = []

  if (inputs.widthInches != null && inputs.widthInches > rule.maxWidthInches) {
    exceedances.push({ dimension: 'width', value: inputs.widthInches, limit: rule.maxWidthInches, unit: 'in' })
  }
  if (inputs.heightInches != null && inputs.heightInches > rule.maxHeightInches) {
    exceedances.push({ dimension: 'height', value: inputs.heightInches, limit: rule.maxHeightInches, unit: 'in' })
  }
  if (inputs.lengthInches != null && inputs.lengthInches > rule.maxLengthInches) {
    exceedances.push({ dimension: 'length', value: inputs.lengthInches, limit: rule.maxLengthInches, unit: 'in' })
  }
  if (inputs.grossWeightPounds != null && inputs.grossWeightPounds > rule.maxGrossWeightPounds) {
    exceedances.push({
      dimension: 'grossWeight',
      value: inputs.grossWeightPounds,
      limit: rule.maxGrossWeightPounds,
      unit: 'lb',
    })
  }
  if (inputs.axleWeightPounds != null && inputs.axleWeightPounds > rule.maxAxleWeightPounds) {
    exceedances.push({
      dimension: 'axleWeight',
      value: inputs.axleWeightPounds,
      limit: rule.maxAxleWeightPounds,
      unit: 'lb',
    })
  }

  const isOverLegal = exceedances.length > 0
  const permitRequired = isOverLegal && rule.permitRequiredAboveLegal

  const escortRequired = Boolean(
    (rule.escortWidthThresholdInches != null &&
      inputs.widthInches != null &&
      inputs.widthInches > rule.escortWidthThresholdInches) ||
      (rule.escortHeightThresholdInches != null &&
        inputs.heightInches != null &&
        inputs.heightInches > rule.escortHeightThresholdInches) ||
      (rule.escortLengthThresholdInches != null &&
        inputs.lengthInches != null &&
        inputs.lengthInches > rule.escortLengthThresholdInches),
  )

  const policeEscortRequired = Boolean(
    rule.policeEscortWidthThresholdInches != null &&
      inputs.widthInches != null &&
      inputs.widthInches > rule.policeEscortWidthThresholdInches,
  )

  const notes: string[] = []
  if (permitRequired) notes.push(encodeGuidanceNote('oversize.notes.permitRequired', { state: rule.stateCode }))
  if (escortRequired) notes.push(encodeGuidanceNote('oversize.notes.escortRequired', { state: rule.stateCode }))
  if (policeEscortRequired) {
    notes.push(encodeGuidanceNote('oversize.notes.policeEscortRequired', { state: rule.stateCode }))
  }
  if (!isOverLegal) notes.push(encodeGuidanceNote('oversize.notes.withinLegalLimits', { state: rule.stateCode }))

  const travelRestrictions: string[] = []
  if (rule.travelRestrictions.nightTravelProhibited) {
    travelRestrictions.push(encodeGuidanceNote('oversize.restrictions.night'))
  }
  if (rule.travelRestrictions.weekendTravelProhibited) {
    travelRestrictions.push(encodeGuidanceNote('oversize.restrictions.weekend'))
  }
  if (rule.travelRestrictions.holidayTravelProhibited) {
    travelRestrictions.push(encodeGuidanceNote('oversize.restrictions.holiday'))
  }
  for (const window of rule.travelRestrictions.curfewWindows ?? []) {
    travelRestrictions.push(
      encodeGuidanceNote('oversize.restrictions.curfew', { start: window.start, end: window.end }),
    )
  }

  return {
    stateCode: rule.stateCode,
    exceedances,
    permitRequired,
    escortRequired,
    policeEscortRequired,
    travelRestrictions,
    notes,
  }
}

const DIMENSION_EXCEEDANCE_GROUPS: Record<OversizeDimension, 'size' | 'weight'> = {
  width: 'size',
  height: 'size',
  length: 'size',
  grossWeight: 'weight',
  axleWeight: 'weight',
}

/**
 * Evaluates one load against every state its route crosses.
 *
 * A missing physical input (width, height, length, gross weight or axle
 * weight) or an empty route (no states to evaluate against) always forces
 * `insufficient_data` — this function never reports "clear" on incomplete
 * information. Each missing input still produces its own warning, and
 * whatever inputs *are* present are still evaluated per state, so a partial
 * evaluation remains informative even though the overall outcome is
 * conservative.
 */
export function evaluateOversize(
  inputs: OversizeLoadInputs,
  rules: OversizeStateRuleInput[],
): OversizeEvaluationOutput {
  const missingDataWarnings: string[] = []
  if (inputs.widthInches == null) missingDataWarnings.push(encodeGuidanceNote('oversize.warnings.missingWidth'))
  if (inputs.heightInches == null) missingDataWarnings.push(encodeGuidanceNote('oversize.warnings.missingHeight'))
  if (inputs.lengthInches == null) missingDataWarnings.push(encodeGuidanceNote('oversize.warnings.missingLength'))
  if (inputs.grossWeightPounds == null) {
    missingDataWarnings.push(encodeGuidanceNote('oversize.warnings.missingGrossWeight'))
  }
  if (inputs.axleWeightPounds == null) {
    missingDataWarnings.push(encodeGuidanceNote('oversize.warnings.missingAxleWeight'))
  }
  if (rules.length === 0) {
    missingDataWarnings.push(encodeGuidanceNote('oversize.warnings.noRouteStates'))
  }

  const stateResults = rules.map((rule) => evaluateForState(inputs, rule))

  const hasAllCoreInputs =
    inputs.widthInches != null &&
    inputs.heightInches != null &&
    inputs.lengthInches != null &&
    inputs.grossWeightPounds != null &&
    inputs.axleWeightPounds != null

  const anyOversize = stateResults.some((result) =>
    result.exceedances.some((e) => DIMENSION_EXCEEDANCE_GROUPS[e.dimension] === 'size'),
  )
  const anyOverweight = stateResults.some((result) =>
    result.exceedances.some((e) => DIMENSION_EXCEEDANCE_GROUPS[e.dimension] === 'weight'),
  )

  let outcome: OversizeOutcome
  if (!hasAllCoreInputs || rules.length === 0) {
    outcome = 'insufficient_data'
  } else if (anyOversize && anyOverweight) {
    outcome = 'oversize_overweight'
  } else if (anyOversize) {
    outcome = 'oversize'
  } else if (anyOverweight) {
    outcome = 'overweight'
  } else {
    outcome = 'clear'
  }

  return {
    outcome,
    permitLikelyRequired: stateResults.some((r) => r.permitRequired),
    escortLikelyRequired: stateResults.some((r) => r.escortRequired),
    policeEscortLikelyRequired: stateResults.some((r) => r.policeEscortRequired),
    stateResults,
    missingDataWarnings,
  }
}
