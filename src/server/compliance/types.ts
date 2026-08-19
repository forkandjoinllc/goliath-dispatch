/**
 * The compliance gate vocabulary.
 *
 * Gates never throw and never talk to the database — they are pure
 * predicates over already-loaded data (see `gates.ts`), which is what makes
 * them exhaustively unit-testable. `service.ts` is the only layer that loads
 * data and calls a gate.
 */

export type ComplianceSeverity = 'blocking' | 'warning'

export interface ComplianceReason {
  /** Stable machine code, e.g. `vin_not_on_coi`. Used by tests and callers that branch on cause. */
  code: string
  /** i18n key rendered verbatim by the UI in either language. */
  messageKey: string
  /** Interpolation values for `messageKey`. */
  params?: Record<string, string | number>
  severity: ComplianceSeverity
}

export interface ComplianceResult {
  /** True only when there are no blocking reasons. Warnings never flip this to false. */
  ok: boolean
  blocking: ComplianceReason[]
  warnings: ComplianceReason[]
}

/** Builds a `ComplianceResult` from a flat reason list, splitting by severity. */
export function toComplianceResult(reasons: ComplianceReason[]): ComplianceResult {
  const blocking = reasons.filter((r) => r.severity === 'blocking')
  const warnings = reasons.filter((r) => r.severity === 'warning')
  return { ok: blocking.length === 0, blocking, warnings }
}

/** Merges several `ComplianceResult`s (e.g. the composite dispatch gate). */
export function mergeComplianceResults(results: ComplianceResult[]): ComplianceResult {
  const blocking = results.flatMap((r) => r.blocking)
  const warnings = results.flatMap((r) => r.warnings)
  return { ok: blocking.length === 0, blocking, warnings }
}

function blockingReason(
  code: string,
  messageKey: string,
  params?: Record<string, string | number>,
): ComplianceReason {
  return { code, messageKey, params, severity: 'blocking' }
}

function warningReason(
  code: string,
  messageKey: string,
  params?: Record<string, string | number>,
): ComplianceReason {
  return { code, messageKey, params, severity: 'warning' }
}

export { blockingReason, warningReason }
