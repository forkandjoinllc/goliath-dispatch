import { describe, expect, it } from 'vitest'
import { buildSealInput, computeIntegritySeal, type SealInputFields } from '@/server/signatures/service'

function fields(overrides: Partial<SealInputFields> = {}): SealInputFields {
  return {
    templateContentHash: 'a'.repeat(64),
    templateVersion: 1,
    documentSha256: 'b'.repeat(64),
    signatureSha256: 'c'.repeat(64),
    consentCopyHash: 'd'.repeat(64),
    signerLegalName: 'Jordan Rivera',
    signerEmail: 'jordan@example.test',
    signerUserId: 'user-1',
    tenantId: 'tenant-1',
    requestId: 'request-1',
    signedAt: new Date('2026-01-01T12:00:00.000Z'),
    ...overrides,
  }
}

describe('buildSealInput / computeIntegritySeal', () => {
  it('is deterministic for identical inputs', () => {
    const a = computeIntegritySeal(fields())
    const b = computeIntegritySeal(fields())
    expect(a).toBe(b)
  })

  it('produces a hex HMAC-SHA256 digest', () => {
    expect(computeIntegritySeal(fields())).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes when signerUserId is null vs a value (still deterministic per-value)', () => {
    const withUser = buildSealInput(fields({ signerUserId: 'user-1' }))
    const withoutUser = buildSealInput(fields({ signerUserId: null }))
    expect(withUser).not.toBe(withoutUser)
  })

  const variations: Array<[keyof SealInputFields, Partial<SealInputFields>]> = [
    ['templateContentHash', { templateContentHash: 'z'.repeat(64) }],
    ['templateVersion', { templateVersion: 2 }],
    ['documentSha256', { documentSha256: 'z'.repeat(64) }],
    ['signatureSha256', { signatureSha256: 'z'.repeat(64) }],
    ['consentCopyHash', { consentCopyHash: 'z'.repeat(64) }],
    ['signerLegalName', { signerLegalName: 'Someone Else' }],
    ['signerEmail', { signerEmail: 'someone@example.test' }],
    ['signerUserId', { signerUserId: 'a-different-user' }],
    ['tenantId', { tenantId: 'a-different-tenant' }],
    ['requestId', { requestId: 'a-different-request' }],
    ['signedAt', { signedAt: new Date('2027-06-15T00:00:00.001Z') }],
  ]

  it.each(variations)('changes the seal when %s changes', (_field, override) => {
    const base = computeIntegritySeal(fields())
    const changed = computeIntegritySeal(fields(override))
    expect(changed).not.toBe(base)
  })

  it('covers all eleven documented seal inputs', () => {
    expect(variations).toHaveLength(11)
  })
})
