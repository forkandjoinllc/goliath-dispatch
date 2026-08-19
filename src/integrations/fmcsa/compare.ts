import { normalizeForIndex } from '@/lib/crypto'
import { normalizeCompanyName } from '@/lib/utils'
import type { FmcsaCarrierSnapshot } from './types'

/** What the tenant typed during onboarding — the side FMCSA is checked against. */
export interface EnteredCarrierIdentity {
  dotNumber: string
  mcNumber?: string | null
  legalName?: string | null
}

export interface FmcsaMismatch {
  field: 'dotNumber' | 'mcNumber' | 'legalName' | 'operatingAuthority' | 'insuranceOnFile'
  entered: string | null
  reported: string | null
}

export interface FmcsaCompareResult {
  /** 'failed' means identity itself did not match (wrong DOT); 'mismatch' is a softer, reviewable difference. */
  status: 'verified' | 'mismatch' | 'failed'
  mismatches: FmcsaMismatch[]
  /** True when the compliance gate must stay closed until an Admin/Accounting override is recorded. */
  blocking: boolean
}

/**
 * Compares tenant-entered carrier identity to what FMCSA reports.
 *
 * - DOT and MC are compared strictly (digits/punctuation-insensitive, but no
 *   fuzzy matching) — either mismatching is always blocking.
 * - Legal name is compared with `normalizeCompanyName`, which strips legal
 *   suffixes (LLC/Inc/Corp/…), case and punctuation — a suffix or casing
 *   difference alone is not blocking, it is surfaced for human review.
 * - An operating authority that is not `'active'` is always blocking,
 *   regardless of anything else matching.
 * - Missing insurance on file is surfaced as a reviewable (non-blocking)
 *   mismatch; the compliance layer decides whether to gate on it.
 */
export function compareEnteredToReported(
  entered: EnteredCarrierIdentity,
  snapshot: FmcsaCarrierSnapshot,
): FmcsaCompareResult {
  const mismatches: FmcsaMismatch[] = []
  let blocking = false
  let identityFailed = false

  const enteredDot = normalizeForIndex(entered.dotNumber)
  const reportedDot = normalizeForIndex(snapshot.dotNumber)
  if (enteredDot !== reportedDot) {
    mismatches.push({ field: 'dotNumber', entered: entered.dotNumber, reported: snapshot.dotNumber })
    blocking = true
    identityFailed = true
  }

  if (entered.mcNumber && snapshot.mcNumber) {
    if (normalizeForIndex(entered.mcNumber) !== normalizeForIndex(snapshot.mcNumber)) {
      mismatches.push({ field: 'mcNumber', entered: entered.mcNumber, reported: snapshot.mcNumber })
      blocking = true
    }
  }

  if (entered.legalName && snapshot.legalName) {
    if (normalizeCompanyName(entered.legalName) !== normalizeCompanyName(snapshot.legalName)) {
      mismatches.push({ field: 'legalName', entered: entered.legalName, reported: snapshot.legalName })
      // Suffix/casing-tolerant difference: reviewable, not blocking on its own.
    }
  }

  if (snapshot.operatingAuthority !== 'active') {
    mismatches.push({
      field: 'operatingAuthority',
      entered: 'active',
      reported: snapshot.operatingAuthority ?? null,
    })
    blocking = true
  }

  if (snapshot.insuranceOnFile === false) {
    mismatches.push({ field: 'insuranceOnFile', entered: 'true', reported: 'false' })
  }

  const status: FmcsaCompareResult['status'] = identityFailed
    ? 'failed'
    : mismatches.length > 0
      ? 'mismatch'
      : 'verified'

  return { status, mismatches, blocking }
}
