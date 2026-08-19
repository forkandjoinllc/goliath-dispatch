import 'server-only'
import { asc, inArray } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { oversizeRules, type OversizeRule } from '@/db/schema'
import { notFound } from '@/lib/errors'
import type { OversizeStateRuleInput } from './evaluate'

/**
 * Per-state oversize rule CRUD.
 *
 * All 52 rows (50 states + DC + PR, per `stateCodeEnum`) are seeded at
 * provisioning by `src/server/tenants/oversize-seed-data.ts`; nothing here
 * creates or deletes a row — only `oversize:rule:manage` (Admin) may edit
 * one, and every row always exists so `getRulesForStates` can never silently
 * skip a state the route actually crosses.
 *
 * `oversizeRules.sourceNote` and `.travelRestrictions.notes` are both single
 * `text` columns in the schema, but the product requires bilingual notes.
 * Rather than reshape the schema, both columns store an *encoded* pair —
 * `encodeBilingualText` / `decodeBilingualText` below — so a Spanish-reading
 * dispatcher and an English-reading one see the operator's own words in
 * their own language, sourced from the same row.
 */

const BILINGUAL_SEPARATOR = '␞'

export interface BilingualText {
  en: string
  es: string
}

/** `en` and `es` are the tenant's own authored guidance — not app UI copy, so this is not an i18n key. */
export function encodeBilingualText(text: BilingualText): string {
  return `${text.en}${BILINGUAL_SEPARATOR}${text.es}`
}

export function decodeBilingualText(raw: string | null | undefined): BilingualText {
  if (!raw) return { en: '', es: '' }
  const separatorIndex = raw.indexOf(BILINGUAL_SEPARATOR)
  if (separatorIndex === -1) return { en: raw, es: raw }
  return { en: raw.slice(0, separatorIndex), es: raw.slice(separatorIndex + BILINGUAL_SEPARATOR.length) }
}

export async function listOversizeRules(db: TenantDb): Promise<OversizeRule[]> {
  return db.findMany(oversizeRules, { orderBy: asc(oversizeRules.stateCode) })
}

export async function getOversizeRule(db: TenantDb, ruleId: string): Promise<OversizeRule> {
  return db.requireById(oversizeRules, ruleId, 'oversizeRule')
}

/**
 * Every rule the given states need, deduplicated and ordered to match the
 * input order (the route's travel order) — a state absent from this
 * tenant's table (should never happen; all 52 are seeded) is simply skipped
 * rather than thrown, so a data gap degrades to `insufficient_data`
 * (via the empty-rules-for-that-state path in `evaluateOversize`) instead of
 * blocking the whole evaluation.
 */
export async function getRulesForStates(db: TenantDb, stateCodes: string[]): Promise<OversizeRule[]> {
  const unique = [...new Set(stateCodes)]
  if (unique.length === 0) return []

  const rows = await db.findMany(oversizeRules, { where: inArray(oversizeRules.stateCode, unique) })
  const byState = new Map(rows.map((row) => [row.stateCode, row]))
  return unique.map((code) => byState.get(code)).filter((row): row is OversizeRule => Boolean(row))
}

/** Projects a persisted rule row into the pure engine's input shape. */
export function toEngineRuleInput(rule: OversizeRule): OversizeStateRuleInput {
  return {
    stateCode: rule.stateCode,
    maxWidthInches: rule.maxWidthInches,
    maxHeightInches: rule.maxHeightInches,
    maxLengthInches: rule.maxLengthInches,
    maxGrossWeightPounds: rule.maxGrossWeightPounds,
    maxAxleWeightPounds: rule.maxAxleWeightPounds,
    escortWidthThresholdInches: rule.escortWidthThresholdInches,
    escortHeightThresholdInches: rule.escortHeightThresholdInches,
    escortLengthThresholdInches: rule.escortLengthThresholdInches,
    policeEscortWidthThresholdInches: rule.policeEscortWidthThresholdInches,
    travelRestrictions: {
      nightTravelProhibited: rule.travelRestrictions.nightTravelProhibited,
      weekendTravelProhibited: rule.travelRestrictions.weekendTravelProhibited,
      holidayTravelProhibited: rule.travelRestrictions.holidayTravelProhibited,
      curfewWindows: rule.travelRestrictions.curfewWindows,
    },
    permitRequiredAboveLegal: rule.permitRequiredAboveLegal,
  }
}

export interface UpdateOversizeRuleInput {
  maxWidthInches?: number
  maxHeightInches?: number
  maxLengthInches?: number
  maxGrossWeightPounds?: number
  maxAxleWeightPounds?: number
  escortWidthThresholdInches?: number | null
  escortHeightThresholdInches?: number | null
  escortLengthThresholdInches?: number | null
  policeEscortWidthThresholdInches?: number | null
  nightTravelProhibited?: boolean
  weekendTravelProhibited?: boolean
  holidayTravelProhibited?: boolean
  curfewWindows?: Array<{ start: string; end: string; note?: string }>
  permitRequiredAboveLegal?: boolean
  permitAuthorityName?: string | null
  permitAuthorityUrl?: string | null
  sourceNoteEn?: string
  sourceNoteEs?: string
  travelRestrictionsNoteEn?: string
  travelRestrictionsNoteEs?: string
}

/** Admin-only in practice (`oversize:rule:manage`). */
export async function updateOversizeRule(
  db: TenantDb,
  ruleId: string,
  input: UpdateOversizeRuleInput,
): Promise<OversizeRule> {
  const rule = await db.requireById(oversizeRules, ruleId, 'oversizeRule')

  const currentTravelNote = decodeBilingualText(rule.travelRestrictions.notes)
  const nextTravelNote: BilingualText = {
    en: input.travelRestrictionsNoteEn ?? currentTravelNote.en,
    es: input.travelRestrictionsNoteEs ?? currentTravelNote.es,
  }

  const currentSourceNote = decodeBilingualText(rule.sourceNote)
  const nextSourceNote: BilingualText = {
    en: input.sourceNoteEn ?? currentSourceNote.en,
    es: input.sourceNoteEs ?? currentSourceNote.es,
  }

  const updated = await db.update(oversizeRules, ruleId, {
    maxWidthInches: input.maxWidthInches ?? rule.maxWidthInches,
    maxHeightInches: input.maxHeightInches ?? rule.maxHeightInches,
    maxLengthInches: input.maxLengthInches ?? rule.maxLengthInches,
    maxGrossWeightPounds: input.maxGrossWeightPounds ?? rule.maxGrossWeightPounds,
    maxAxleWeightPounds: input.maxAxleWeightPounds ?? rule.maxAxleWeightPounds,
    escortWidthThresholdInches:
      input.escortWidthThresholdInches !== undefined
        ? input.escortWidthThresholdInches
        : rule.escortWidthThresholdInches,
    escortHeightThresholdInches:
      input.escortHeightThresholdInches !== undefined
        ? input.escortHeightThresholdInches
        : rule.escortHeightThresholdInches,
    escortLengthThresholdInches:
      input.escortLengthThresholdInches !== undefined
        ? input.escortLengthThresholdInches
        : rule.escortLengthThresholdInches,
    policeEscortWidthThresholdInches:
      input.policeEscortWidthThresholdInches !== undefined
        ? input.policeEscortWidthThresholdInches
        : rule.policeEscortWidthThresholdInches,
    travelRestrictions: {
      nightTravelProhibited: input.nightTravelProhibited ?? rule.travelRestrictions.nightTravelProhibited,
      weekendTravelProhibited: input.weekendTravelProhibited ?? rule.travelRestrictions.weekendTravelProhibited,
      holidayTravelProhibited: input.holidayTravelProhibited ?? rule.travelRestrictions.holidayTravelProhibited,
      curfewWindows: input.curfewWindows ?? rule.travelRestrictions.curfewWindows,
      notes: encodeBilingualText(nextTravelNote),
    },
    permitRequiredAboveLegal: input.permitRequiredAboveLegal ?? rule.permitRequiredAboveLegal,
    permitAuthorityName: input.permitAuthorityName ?? rule.permitAuthorityName,
    permitAuthorityUrl: input.permitAuthorityUrl ?? rule.permitAuthorityUrl,
    sourceNote: encodeBilingualText(nextSourceNote),
    lastReviewedAt: new Date(),
  })
  if (!updated) throw notFound('errors.notFound', { entity: 'oversizeRule' })
  return updated
}
