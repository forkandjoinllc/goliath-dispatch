import { describe, expect, it } from 'vitest'
import {
  detectDuplicateCustomers,
  type ExistingCustomerForDuplicateCheck,
} from '@/server/customers/duplicates'

/**
 * Placed alongside the rest of the loads domain's unit suite per the task's
 * test-directory mapping; the function under test lives in
 * `src/server/customers/duplicates.ts`.
 */

function existing(overrides: Partial<ExistingCustomerForDuplicateCheck> = {}): ExistingCustomerForDuplicateCheck {
  return {
    id: 'cust-1',
    companyName: 'Summit Freight LLC',
    companyNameNormalized: 'summit freight',
    dotNumber: null,
    mcNumber: null,
    phoneNormalized: null,
    emailNormalized: null,
    physicalLine1: null,
    physicalCity: null,
    physicalState: null,
    physicalPostalCode: null,
    ...overrides,
  }
}

describe('detectDuplicateCustomers — priority order', () => {
  it('matches on DOT number first, even when nothing else matches', () => {
    const candidate = existing({ id: 'cust-1', dotNumber: '1234567' })
    const matches = detectDuplicateCustomers(
      { companyName: 'Totally Different Name', dotNumber: '1234567' },
      [candidate],
    )
    expect(matches).toEqual([{ customerId: 'cust-1', matchedOn: 'dot', confidence: 'exact', label: candidate.companyName }])
  })

  it('matches on MC number when DOT does not match', () => {
    const candidate = existing({ id: 'cust-1', mcNumber: '987654' })
    const matches = detectDuplicateCustomers({ companyName: 'Another Name', mcNumber: '987654' }, [candidate])
    expect(matches).toEqual([{ customerId: 'cust-1', matchedOn: 'mc', confidence: 'exact', label: candidate.companyName }])
  })

  it('falls through to phone when DOT/MC do not match', () => {
    const candidate = existing({ id: 'cust-1', phoneNormalized: '2145551212' })
    const matches = detectDuplicateCustomers({ companyName: 'Another Name', phone: '(214) 555-1212' }, [candidate])
    expect(matches).toEqual([{ customerId: 'cust-1', matchedOn: 'phone', confidence: 'exact', label: candidate.companyName }])
  })

  it('falls through to email when phone does not match', () => {
    const candidate = existing({ id: 'cust-1', emailNormalized: 'ops@summit.test' })
    const matches = detectDuplicateCustomers({ companyName: 'Another Name', email: 'OPS@Summit.test' }, [candidate])
    expect(matches).toEqual([{ customerId: 'cust-1', matchedOn: 'email', confidence: 'exact', label: candidate.companyName }])
  })

  it('falls through to normalized name + address only once dot/mc/phone/email are exhausted', () => {
    const candidate = existing({
      id: 'cust-1',
      companyName: 'Summit Freight, LLC.',
      companyNameNormalized: 'summit freight',
      physicalLine1: '100 Main St',
      physicalCity: 'Dallas',
      physicalState: 'TX',
      physicalPostalCode: '75201',
    })
    const matches = detectDuplicateCustomers(
      {
        companyName: 'Summit Freight LLC',
        physicalLine1: '100 Main St',
        physicalCity: 'Dallas',
        physicalState: 'TX',
        physicalPostalCode: '75201',
      },
      [candidate],
    )
    expect(matches).toEqual([
      { customerId: 'cust-1', matchedOn: 'name_address', confidence: 'likely', label: candidate.companyName },
    ])
  })

  it('reports a candidate only once, at its highest-priority match', () => {
    const candidate = existing({
      id: 'cust-1',
      dotNumber: '1234567',
      companyNameNormalized: 'summit freight',
      phoneNormalized: '2145551212',
    })
    const matches = detectDuplicateCustomers(
      { companyName: 'Summit Freight', dotNumber: '1234567', phone: '(214) 555-1212' },
      [candidate],
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]!.matchedOn).toBe('dot')
  })
})

describe('detectDuplicateCustomers — negative cases', () => {
  it('returns no matches when nothing overlaps', () => {
    const candidate = existing({ id: 'cust-1', dotNumber: '1111111' })
    const matches = detectDuplicateCustomers(
      { companyName: 'A Completely Different Company', dotNumber: '2222222', phone: '5125550000', email: 'x@y.test' },
      [candidate],
    )
    expect(matches).toEqual([])
  })

  it('does not match on name alone without a matching address', () => {
    const candidate = existing({
      id: 'cust-1',
      companyNameNormalized: 'summit freight',
      physicalLine1: '100 Main St',
      physicalCity: 'Dallas',
      physicalState: 'TX',
      physicalPostalCode: '75201',
    })
    const matches = detectDuplicateCustomers(
      { companyName: 'Summit Freight LLC', physicalLine1: '900 Other Ave', physicalCity: 'Austin', physicalState: 'TX', physicalPostalCode: '78701' },
      [candidate],
    )
    expect(matches).toEqual([])
  })

  it('does not match on address alone without a matching normalized name', () => {
    const candidate = existing({
      id: 'cust-1',
      companyNameNormalized: 'other company',
      physicalLine1: '100 Main St',
      physicalCity: 'Dallas',
      physicalState: 'TX',
      physicalPostalCode: '75201',
    })
    const matches = detectDuplicateCustomers(
      { companyName: 'Summit Freight LLC', physicalLine1: '100 Main St', physicalCity: 'Dallas', physicalState: 'TX', physicalPostalCode: '75201' },
      [candidate],
    )
    expect(matches).toEqual([])
  })

  it('returns an empty array against an empty candidate pool', () => {
    expect(detectDuplicateCustomers({ companyName: 'Anyone' }, [])).toEqual([])
  })
})
