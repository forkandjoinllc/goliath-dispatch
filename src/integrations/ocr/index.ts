import { serverEnv } from '@/lib/env'
import type { OcrProvider } from './provider'
import { MockOcrAdapter } from './mock-adapter'
import { TextractOcrAdapter } from './textract-adapter'
import { DocAiOcrAdapter } from './docai-adapter'

let cached: OcrProvider | null = null

/**
 * Resolves the configured OCR provider. `TextractOcrAdapter` /
 * `DocAiOcrAdapter` never load their (uninstalled) SDKs at construction —
 * only `extractFromDocument()` does, lazily — so selecting either driver
 * without the package installed fails clearly on first real use, not here.
 */
export function getOcrProvider(): OcrProvider {
  if (cached) return cached
  const driver = serverEnv().OCR_DRIVER
  if (driver === 'textract') {
    cached = new TextractOcrAdapter()
  } else if (driver === 'docai') {
    cached = new DocAiOcrAdapter()
  } else {
    cached = new MockOcrAdapter()
  }
  return cached
}

/** Test-only: clears the memoized provider so a test can flip the driver env var. */
export function resetOcrProviderCache(): void {
  cached = null
}

export type { OcrProvider } from './provider'
export type { ExtractionResult } from './types'
export { extractVins } from './vin-extractor'
export { mockCoiWithVins, clearMockCoiFixtures } from './mock-adapter'
