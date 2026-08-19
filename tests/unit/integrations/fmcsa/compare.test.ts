import { describe, expect, it } from 'vitest'
import { compareEnteredToReported } from '@/integrations/fmcsa/compare'
import {
  FMCSA_MOCK_DOT_CLEAN,
  FMCSA_MOCK_DOT_NAME_MISMATCH,
  FMCSA_MOCK_DOT_NO_AUTHORITY,
  FMCSA_MOCK_DOT_NO_INSURANCE,
  MockFmcsaAdapter,
} from '@/integrations/fmcsa/mock-adapter'

const adapter = new MockFmcsaAdapter()

async function snapshotOf(dot: string) {
  const result = await adapter.lookupByDot(dot)
  if (!result.ok) throw new Error(`fixture ${dot} not found`)
  return result.data
}

describe('compareEnteredToReported', () => {
  it('verifies a clean carrier with matching identity', async () => {
    const snapshot = await snapshotOf(FMCSA_MOCK_DOT_CLEAN)
    const result = compareEnteredToReported(
      { dotNumber: FMCSA_MOCK_DOT_CLEAN, mcNumber: '500001', legalName: 'Summit Heavy Haul LLC' },
      snapshot,
    )
    expect(result.status).toBe('verified')
    expect(result.mismatches).toHaveLength(0)
    expect(result.blocking).toBe(false)
  })

  it('is tolerant of legal-suffix and punctuation/case differences in the name', async () => {
    const snapshot = await snapshotOf(FMCSA_MOCK_DOT_CLEAN)
    const result = compareEnteredToReported(
      { dotNumber: FMCSA_MOCK_DOT_CLEAN, legalName: 'summit heavy haul, L.L.C.' },
      snapshot,
    )
    expect(result.status).toBe('verified')
    expect(result.blocking).toBe(false)
  })

  it('flags a real name difference as a non-blocking mismatch', async () => {
    const snapshot = await snapshotOf(FMCSA_MOCK_DOT_NAME_MISMATCH)
    const result = compareEnteredToReported(
      { dotNumber: FMCSA_MOCK_DOT_NAME_MISMATCH, legalName: 'Summit Heavy Haul LLC' },
      snapshot,
    )
    expect(result.status).toBe('mismatch')
    expect(result.mismatches.some((m) => m.field === 'legalName')).toBe(true)
    expect(result.blocking).toBe(false)
  })

  it('treats a DOT mismatch as a strict, blocking identity failure', async () => {
    const snapshot = await snapshotOf(FMCSA_MOCK_DOT_CLEAN)
    const result = compareEnteredToReported({ dotNumber: '9999999' }, snapshot)
    expect(result.status).toBe('failed')
    expect(result.blocking).toBe(true)
    expect(result.mismatches).toContainEqual({
      field: 'dotNumber',
      entered: '9999999',
      reported: FMCSA_MOCK_DOT_CLEAN,
    })
  })

  it('treats an MC mismatch as strict and blocking', async () => {
    const snapshot = await snapshotOf(FMCSA_MOCK_DOT_CLEAN)
    const result = compareEnteredToReported(
      { dotNumber: FMCSA_MOCK_DOT_CLEAN, mcNumber: '999999' },
      snapshot,
    )
    expect(result.blocking).toBe(true)
    expect(result.mismatches.some((m) => m.field === 'mcNumber')).toBe(true)
  })

  it('always blocks on a non-active operating authority', async () => {
    const snapshot = await snapshotOf(FMCSA_MOCK_DOT_NO_AUTHORITY)
    const result = compareEnteredToReported({ dotNumber: FMCSA_MOCK_DOT_NO_AUTHORITY }, snapshot)
    expect(result.blocking).toBe(true)
    expect(result.mismatches.some((m) => m.field === 'operatingAuthority')).toBe(true)
  })

  it('flags missing insurance as reviewable but non-blocking', async () => {
    const snapshot = await snapshotOf(FMCSA_MOCK_DOT_NO_INSURANCE)
    const result = compareEnteredToReported({ dotNumber: FMCSA_MOCK_DOT_NO_INSURANCE }, snapshot)
    expect(result.mismatches.some((m) => m.field === 'insuranceOnFile')).toBe(true)
    expect(result.status).toBe('mismatch')
  })
})
