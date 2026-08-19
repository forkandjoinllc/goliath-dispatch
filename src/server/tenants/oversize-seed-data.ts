import { stateCodeEnum } from '@/db/schema/_shared'
import type { oversizeRules } from '@/db/schema'

/**
 * Seed data for `oversize_rules`, one row per the 52 codes in `stateCodeEnum`
 * (50 states + DC + PR).
 *
 * These are representative federal/state baselines meant to give a new
 * tenant a usable starting point, not a legal determination — every row
 * carries a `sourceNote` saying exactly that, and every value is editable by
 * an Admin afterward (`oversize:rule:manage`). The federal baseline (23 CFR
 * 658) is 102" width, 13'6" height, 53' trailer length and 80,000 lb gross;
 * a handful of western/mountain states are seeded with a taller legal height
 * because that variance is well documented and worth reflecting, not because
 * this table is a substitute for checking the state DOT permit office.
 */

const FEDERAL_BASELINE = {
  maxWidthInches: 102,
  maxHeightInches: 162, // 13'6"
  maxLengthInches: 636, // 53'
  maxGrossWeightPounds: 80_000,
  maxAxleWeightPounds: 20_000,
  escortWidthThresholdInches: 126, // 10'6"
  escortHeightThresholdInches: 170, // 14'2"
  escortLengthThresholdInches: 1080, // 90'
  policeEscortWidthThresholdInches: 144, // 12'0"
}

/** States commonly cited as allowing a taller legal height without a permit. */
const TALLER_LEGAL_HEIGHT_STATES = new Set([
  'AZ',
  'CO',
  'ID',
  'MT',
  'NV',
  'NM',
  'OR',
  'UT',
  'WA',
  'WY',
])

/** States commonly cited with a longer legal combination length. */
const LONGER_LEGAL_LENGTH_STATES = new Set(['MT', 'NV', 'OR', 'ID'])

const STANDARD_SOURCE_NOTE =
  'Operator-maintained guidance seeded from common federal/state baselines at tenant setup. Not legal advice — verify current limits with the state permitting authority before dispatch.'

export type OversizeRuleSeedRow = Omit<typeof oversizeRules.$inferInsert, 'tenantId' | 'id'>

export function defaultOversizeRules(): OversizeRuleSeedRow[] {
  return stateCodeEnum.enumValues.map((stateCode) => {
    const maxHeightInches = TALLER_LEGAL_HEIGHT_STATES.has(stateCode)
      ? FEDERAL_BASELINE.maxHeightInches + 6 // 14'0"
      : FEDERAL_BASELINE.maxHeightInches
    const maxLengthInches = LONGER_LEGAL_LENGTH_STATES.has(stateCode)
      ? FEDERAL_BASELINE.maxLengthInches + 60 // 58'6" combination allowance
      : FEDERAL_BASELINE.maxLengthInches

    return {
      stateCode,
      maxWidthInches: FEDERAL_BASELINE.maxWidthInches,
      maxHeightInches,
      maxLengthInches,
      maxGrossWeightPounds: FEDERAL_BASELINE.maxGrossWeightPounds,
      maxAxleWeightPounds: FEDERAL_BASELINE.maxAxleWeightPounds,
      escortWidthThresholdInches: FEDERAL_BASELINE.escortWidthThresholdInches,
      escortHeightThresholdInches: FEDERAL_BASELINE.escortHeightThresholdInches,
      escortLengthThresholdInches: FEDERAL_BASELINE.escortLengthThresholdInches,
      policeEscortWidthThresholdInches: FEDERAL_BASELINE.policeEscortWidthThresholdInches,
      travelRestrictions: {
        nightTravelProhibited: true,
        weekendTravelProhibited: false,
        holidayTravelProhibited: true,
        notes: 'Default guidance: avoid travel from sunset to sunrise and on federally observed holidays pending state confirmation.',
      },
      permitRequiredAboveLegal: true,
      permitAuthorityName: `${stateCode} Department of Transportation — Oversize/Overweight Permits`,
      permitAuthorityUrl: null,
      sourceNote: STANDARD_SOURCE_NOTE,
      lastReviewedAt: new Date(),
    } satisfies OversizeRuleSeedRow
  })
}
