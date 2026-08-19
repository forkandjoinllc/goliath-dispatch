import { normalizeCompanyName, normalizeEmail, normalizePhone } from '@/lib/utils'

/**
 * Customer duplicate detection.
 *
 * Pure and deterministic: the service layer loads a small set of candidate
 * customers (via the indexed dot/mc/phone/email/name columns) and hands them
 * here before every insert. Nothing in this file touches the database, which
 * is what makes the priority order exhaustively unit-testable against
 * hand-built fixtures.
 *
 * Priority order (a customer matched by an earlier tier is never re-reported
 * by a later one):
 *   1. DOT or MC number, exact match — `confidence: 'exact'`
 *   2. Phone or email, exact match on the normalized columns — `confidence: 'exact'`
 *   3. Normalized company name AND normalized address — `confidence: 'likely'`
 */

export type DuplicateMatchedOn = 'dot' | 'mc' | 'phone' | 'email' | 'name_address'
export type DuplicateConfidence = 'exact' | 'likely'

export interface DuplicateMatch {
  customerId: string
  matchedOn: DuplicateMatchedOn
  confidence: DuplicateConfidence
  label: string
}

export interface DuplicateCandidateInput {
  companyName: string
  dotNumber?: string | null
  mcNumber?: string | null
  phone?: string | null
  email?: string | null
  physicalLine1?: string | null
  physicalCity?: string | null
  physicalState?: string | null
  physicalPostalCode?: string | null
}

/** The projection of an existing customer row the detector needs. */
export interface ExistingCustomerForDuplicateCheck {
  id: string
  companyName: string
  companyNameNormalized: string
  dotNumber: string | null
  mcNumber: string | null
  phoneNormalized: string | null
  emailNormalized: string | null
  physicalLine1: string | null
  physicalCity: string | null
  physicalState: string | null
  physicalPostalCode: string | null
}

function normalizeAddressKey(input: {
  physicalLine1?: string | null
  physicalCity?: string | null
  physicalState?: string | null
  physicalPostalCode?: string | null
}): string | null {
  const parts = [input.physicalLine1, input.physicalCity, input.physicalState, input.physicalPostalCode].map(
    (part) => (part ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  )
  if (parts.every((part) => part === '')) return null
  return parts.join('|')
}

/**
 * Returns every match found, ordered by priority tier, deduplicated so a
 * single existing customer is reported once — at the highest-priority tier
 * it matched on. Returns an empty array when nothing matches.
 */
export function detectDuplicateCustomers(
  candidate: DuplicateCandidateInput,
  existing: ExistingCustomerForDuplicateCheck[],
): DuplicateMatch[] {
  const matches = new Map<string, DuplicateMatch>()
  const record = (customer: ExistingCustomerForDuplicateCheck, matchedOn: DuplicateMatchedOn, confidence: DuplicateConfidence) => {
    if (matches.has(customer.id)) return
    matches.set(customer.id, { customerId: customer.id, matchedOn, confidence, label: customer.companyName })
  }

  const candidateDot = candidate.dotNumber?.trim() || null
  const candidateMc = candidate.mcNumber?.trim() || null
  const candidatePhone = normalizePhone(candidate.phone)
  const candidateEmail = normalizeEmail(candidate.email)
  const candidateNameNormalized = normalizeCompanyName(candidate.companyName)
  const candidateAddressKey = normalizeAddressKey(candidate)

  // Tier 1 — DOT or MC exact.
  for (const existingCustomer of existing) {
    if (candidateDot && existingCustomer.dotNumber && existingCustomer.dotNumber === candidateDot) {
      record(existingCustomer, 'dot', 'exact')
    } else if (candidateMc && existingCustomer.mcNumber && existingCustomer.mcNumber === candidateMc) {
      record(existingCustomer, 'mc', 'exact')
    }
  }

  // Tier 2 — phone or email exact.
  for (const existingCustomer of existing) {
    if (matches.has(existingCustomer.id)) continue
    if (candidatePhone && existingCustomer.phoneNormalized && existingCustomer.phoneNormalized === candidatePhone) {
      record(existingCustomer, 'phone', 'exact')
    } else if (
      candidateEmail &&
      existingCustomer.emailNormalized &&
      existingCustomer.emailNormalized === candidateEmail
    ) {
      record(existingCustomer, 'email', 'exact')
    }
  }

  // Tier 3 — normalized company name AND normalized address.
  if (candidateAddressKey) {
    for (const existingCustomer of existing) {
      if (matches.has(existingCustomer.id)) continue
      if (existingCustomer.companyNameNormalized !== candidateNameNormalized) continue
      const existingAddressKey = normalizeAddressKey({
        physicalLine1: existingCustomer.physicalLine1,
        physicalCity: existingCustomer.physicalCity,
        physicalState: existingCustomer.physicalState,
        physicalPostalCode: existingCustomer.physicalPostalCode,
      })
      if (existingAddressKey && existingAddressKey === candidateAddressKey) {
        record(existingCustomer, 'name_address', 'likely')
      }
    }
  }

  return [...matches.values()]
}
