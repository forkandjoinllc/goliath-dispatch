import { describe, expect, it } from 'vitest'
import { evaluateOversize, type OversizeLoadInputs, type OversizeStateRuleInput } from '@/server/oversize/evaluate'
import { decodeGuidanceNote } from '@/server/oversize/notes'

/**
 * `evaluateOversize` is pure — no database, no clock read beyond what's
 * passed in — so every case here is a hand-built fixture, mirroring
 * `tests/unit/compliance/gates.test.ts`'s style.
 */

const TEXAS_RULE: OversizeStateRuleInput = {
  stateCode: 'TX',
  maxWidthInches: 102,
  maxHeightInches: 162,
  maxLengthInches: 636,
  maxGrossWeightPounds: 80_000,
  maxAxleWeightPounds: 20_000,
  escortWidthThresholdInches: 144, // 12'0"
  escortHeightThresholdInches: 168, // 14'0"
  escortLengthThresholdInches: 960, // 80'0"
  policeEscortWidthThresholdInches: 168, // 14'0"
  travelRestrictions: {},
  permitRequiredAboveLegal: true,
}

const OKLAHOMA_RULE: OversizeStateRuleInput = {
  ...TEXAS_RULE,
  stateCode: 'OK',
  maxWidthInches: 96,
  escortWidthThresholdInches: 120,
  travelRestrictions: { nightTravelProhibited: true },
}

function legalLoad(overrides: Partial<OversizeLoadInputs> = {}): OversizeLoadInputs {
  return {
    widthInches: 96,
    heightInches: 150,
    lengthInches: 600,
    grossWeightPounds: 78_000,
    axleWeightPounds: 19_000,
    axleConfiguration: '5-axle',
    ...overrides,
  }
}

function decodedKeys(notes: string[]): string[] {
  return notes.map((n) => decodeGuidanceNote(n).key)
}

describe('evaluateOversize', () => {
  it('reports clear for a load within every dimension and weight limit', () => {
    const result = evaluateOversize(legalLoad(), [TEXAS_RULE])
    expect(result.outcome).toBe('clear')
    expect(result.permitLikelyRequired).toBe(false)
    expect(result.escortLikelyRequired).toBe(false)
    expect(result.policeEscortLikelyRequired).toBe(false)
    expect(result.missingDataWarnings).toHaveLength(0)
    expect(result.stateResults[0]!.exceedances).toHaveLength(0)
    expect(decodedKeys(result.stateResults[0]!.notes)).toContain('oversize.notes.withinLegalLimits')
  })

  it('flags a 12\'0" (144") wide load as oversize, requiring a permit and an escort', () => {
    const result = evaluateOversize(legalLoad({ widthInches: 144 }), [TEXAS_RULE])
    expect(result.outcome).toBe('oversize')
    expect(result.permitLikelyRequired).toBe(true)
    expect(result.escortLikelyRequired).toBe(false) // exactly at the 144" threshold, not over it
    const state = result.stateResults[0]!
    expect(state.exceedances).toEqual([{ dimension: 'width', value: 144, limit: 102, unit: 'in' }])
    expect(state.permitRequired).toBe(true)
  })

  it('requires an escort once strictly over the escort threshold', () => {
    const result = evaluateOversize(legalLoad({ widthInches: 145 }), [TEXAS_RULE])
    expect(result.stateResults[0]!.escortRequired).toBe(true)
  })

  it('requires a police escort once strictly over the police-escort width threshold', () => {
    const clearOfPolice = evaluateOversize(legalLoad({ widthInches: 168 }), [TEXAS_RULE])
    expect(clearOfPolice.stateResults[0]!.policeEscortRequired).toBe(false)
    expect(clearOfPolice.policeEscortLikelyRequired).toBe(false)

    const overPoliceThreshold = evaluateOversize(legalLoad({ widthInches: 169 }), [TEXAS_RULE])
    expect(overPoliceThreshold.stateResults[0]!.policeEscortRequired).toBe(true)
    expect(overPoliceThreshold.policeEscortLikelyRequired).toBe(true)
    expect(decodedKeys(overPoliceThreshold.stateResults[0]!.notes)).toContain(
      'oversize.notes.policeEscortRequired',
    )
  })

  describe('boundary behavior — exactly at a legal limit is legal, one unit over is not', () => {
    it.each([
      { dimension: 'widthInches' as const, limit: 102, unit: 'in' as const, ruleField: 'maxWidthInches' as const },
      { dimension: 'heightInches' as const, limit: 162, unit: 'in' as const, ruleField: 'maxHeightInches' as const },
      { dimension: 'lengthInches' as const, limit: 636, unit: 'in' as const, ruleField: 'maxLengthInches' as const },
      { dimension: 'grossWeightPounds' as const, limit: 80_000, unit: 'lb' as const, ruleField: 'maxGrossWeightPounds' as const },
      { dimension: 'axleWeightPounds' as const, limit: 20_000, unit: 'lb' as const, ruleField: 'maxAxleWeightPounds' as const },
    ])('$dimension exactly at the limit ($limit) is legal; one over is not', ({ dimension, limit }) => {
      const atLimit = evaluateOversize(legalLoad({ [dimension]: limit }), [TEXAS_RULE])
      expect(atLimit.stateResults[0]!.exceedances).toHaveLength(0)

      const overLimit = evaluateOversize(legalLoad({ [dimension]: limit + 1 }), [TEXAS_RULE])
      expect(overLimit.stateResults[0]!.exceedances).toHaveLength(1)
      expect(overLimit.stateResults[0]!.exceedances[0]!.dimension).toBe(
        dimension === 'grossWeightPounds' ? 'grossWeight' : dimension === 'axleWeightPounds' ? 'axleWeight' : dimension.replace('Inches', ''),
      )
    })
  })

  it('forces insufficient_data when height is missing, with a specific warning, while still evaluating the rest', () => {
    const result = evaluateOversize(legalLoad({ heightInches: null, widthInches: 150 }), [TEXAS_RULE])
    expect(result.outcome).toBe('insufficient_data')
    expect(decodedKeys(result.missingDataWarnings)).toContain('oversize.warnings.missingHeight')
    // The width exceedance is still reported even though the overall outcome is conservative.
    expect(result.stateResults[0]!.exceedances.some((e) => e.dimension === 'width')).toBe(true)
  })

  it('forces insufficient_data when there are no route states to evaluate against', () => {
    const result = evaluateOversize(legalLoad(), [])
    expect(result.outcome).toBe('insufficient_data')
    expect(decodedKeys(result.missingDataWarnings)).toContain('oversize.warnings.noRouteStates')
    expect(result.stateResults).toHaveLength(0)
  })

  it('never reports "clear" when any core input is missing, even if the partial data looks fine', () => {
    const result = evaluateOversize(legalLoad({ axleWeightPounds: null }), [TEXAS_RULE])
    expect(result.outcome).not.toBe('clear')
    expect(result.outcome).toBe('insufficient_data')
  })

  it('evaluates each state on the route independently, since limits differ per state', () => {
    // 100" is within Texas's 102" limit but over Oklahoma's stricter 96" limit.
    const result = evaluateOversize(legalLoad({ widthInches: 100 }), [TEXAS_RULE, OKLAHOMA_RULE])
    const texas = result.stateResults.find((r) => r.stateCode === 'TX')!
    const oklahoma = result.stateResults.find((r) => r.stateCode === 'OK')!
    expect(texas.exceedances).toHaveLength(0)
    expect(oklahoma.exceedances).toEqual([{ dimension: 'width', value: 100, limit: 96, unit: 'in' }])
    expect(result.outcome).toBe('oversize')
  })

  it('surfaces per-state travel restrictions as translatable notes, not baked prose', () => {
    const result = evaluateOversize(legalLoad(), [OKLAHOMA_RULE])
    const oklahoma = result.stateResults[0]!
    expect(decodedKeys(oklahoma.travelRestrictions)).toContain('oversize.restrictions.night')
  })

  it('reports overweight (not oversize) when only a weight limit is exceeded', () => {
    const result = evaluateOversize(legalLoad({ grossWeightPounds: 90_000 }), [TEXAS_RULE])
    expect(result.outcome).toBe('overweight')
  })

  it('reports oversize_overweight when both a size and a weight limit are exceeded', () => {
    const result = evaluateOversize(legalLoad({ widthInches: 145, grossWeightPounds: 90_000 }), [TEXAS_RULE])
    expect(result.outcome).toBe('oversize_overweight')
  })
})
