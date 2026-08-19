import { serverEnv } from '@/lib/env'
import type { FmcsaProvider } from './provider'
import { MockFmcsaAdapter } from './mock-adapter'
import { QcMobileFmcsaAdapter } from './qcmobile-adapter'

let cached: FmcsaProvider | null = null

/**
 * Resolves the configured FMCSA provider. `QcMobileFmcsaAdapter` is only
 * ever *constructed* when `FMCSA_DRIVER=qcmobile` — its constructor is what
 * validates `FMCSA_WEBKEY`, so importing this module never requires
 * credentials; only selecting the live driver does.
 */
export function getFmcsaProvider(): FmcsaProvider {
  if (cached) return cached
  const driver = serverEnv().FMCSA_DRIVER
  cached = driver === 'qcmobile' ? new QcMobileFmcsaAdapter() : new MockFmcsaAdapter()
  return cached
}

/** Test-only: clears the memoized provider so a test can flip the driver env var. */
export function resetFmcsaProviderCache(): void {
  cached = null
}

export type { FmcsaProvider } from './provider'
export type { FmcsaCarrierSnapshot, FmcsaLookupResult, OperatingAuthorityStatus } from './types'
export { compareEnteredToReported } from './compare'
export type { EnteredCarrierIdentity, FmcsaCompareResult, FmcsaMismatch } from './compare'
export {
  FMCSA_MOCK_DOT_CLEAN,
  FMCSA_MOCK_DOT_NAME_MISMATCH,
  FMCSA_MOCK_DOT_NO_AUTHORITY,
  FMCSA_MOCK_DOT_NO_INSURANCE,
  FMCSA_MOCK_DOT_NOT_FOUND,
} from './mock-adapter'
