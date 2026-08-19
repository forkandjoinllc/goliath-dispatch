import { describe, expect, it } from 'vitest'
import { MockFmcsaAdapter, FMCSA_MOCK_DOT_CLEAN, FMCSA_MOCK_DOT_NOT_FOUND } from '@/integrations/fmcsa/mock-adapter'

describe('MockFmcsaAdapter', () => {
  const adapter = new MockFmcsaAdapter()

  it('returns a successful, normalized snapshot for a known DOT', async () => {
    const result = await adapter.lookupByDot(FMCSA_MOCK_DOT_CLEAN)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.dotNumber).toBe(FMCSA_MOCK_DOT_CLEAN)
      expect(result.data.operatingAuthority).toBe('active')
      expect(result.cacheTtlSeconds).toBeGreaterThan(0)
    }
  })

  it('returns a not_found failure for the designated not-found fixture', async () => {
    const result = await adapter.lookupByDot(FMCSA_MOCK_DOT_NOT_FOUND)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('not_found')
      expect(result.error.retryable).toBe(false)
    }
  })

  it('resolves the same carrier by MC number as by DOT', async () => {
    const byDot = await adapter.lookupByDot(FMCSA_MOCK_DOT_CLEAN)
    const byMc = await adapter.lookupByMc('500001')
    expect(byDot.ok && byMc.ok).toBe(true)
    if (byDot.ok && byMc.ok) {
      expect(byMc.data.dotNumber).toBe(byDot.data.dotNumber)
    }
  })
})
