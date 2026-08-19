import { beforeEach, describe, expect, it } from 'vitest'
import { MockOcrAdapter, mockCoiWithVins, clearMockCoiFixtures } from '@/integrations/ocr/mock-adapter'

describe('MockOcrAdapter + mockCoiWithVins', () => {
  beforeEach(() => clearMockCoiFixtures())

  it('round-trips VINs registered via mockCoiWithVins', async () => {
    const vin = '1FUJA6CV12LM3864X'
    const fixture = await mockCoiWithVins([vin])
    const adapter = new MockOcrAdapter()

    const result = await adapter.extractFromDocument(fixture.bytes, fixture.contentType)

    expect(result.vins).toEqual([vin])
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.provider).toBe('ocr.mock')
  })

  it('returns an empty result for bytes with no registered fixture and no embedded VIN', async () => {
    const adapter = new MockOcrAdapter()
    const bytes = new TextEncoder().encode('This document has no vehicle identifiers.')
    const result = await adapter.extractFromDocument(bytes, 'text/plain')
    expect(result.vins).toEqual([])
    expect(result.confidence).toBe(0)
  })

  it('extracts VINs directly from plain text bytes without a fixture', async () => {
    const adapter = new MockOcrAdapter()
    const vin = '5FNRL38409B404567'
    const bytes = new TextEncoder().encode(`Certificate of Insurance\nVIN: ${vin}\n`)
    const result = await adapter.extractFromDocument(bytes, 'text/plain')
    expect(result.vins).toEqual([vin])
  })
})
