import { providerFailure, providerSuccess } from '../_shared/provider'
import type { FmcsaProvider } from './provider'
import type { FmcsaCarrierSnapshot, FmcsaLookupResult } from './types'

const PROVIDER_NAME = 'fmcsa.mock'
const CACHE_TTL_SECONDS = 60 * 60 * 24

/**
 * Deterministic FMCSA fixtures, keyed by DOT number. This is the default
 * FMCSA provider (`FMCSA_DRIVER=mock`) and the one the seed and every test in
 * this repo should reference by these exact numbers — do not invent new
 * fixture DOTs elsewhere; extend this map instead.
 *
 * ┌───────────┬────────────────────────────────────────────────────────────┐
 * │ DOT       │ Scenario                                                   │
 * ├───────────┼────────────────────────────────────────────────────────────┤
 * │ 1000001   │ Clean, active carrier. Legal name "Summit Heavy Haul LLC". │
 * │           │ Active authority, insurance on file. Use for the happy     │
 * │           │ path.                                                     │
 * │ 1000002   │ Reported legal name ("Summit Heavy Haul Logistics          │
 * │           │ Incorporated") differs from what a tenant would plausibly  │
 * │           │ enter ("Summit Heavy Haul LLC") — drives                   │
 * │           │ compareEnteredToReported() into a non-blocking 'mismatch'. │
 * │ 1000003   │ No active operating authority (revoked). Always blocking.  │
 * │ 1000004   │ Active authority but no insurance on file. Non-blocking    │
 * │           │ mismatch the UI should still flag.                        │
 * │ 1000005   │ Not on file at FMCSA at all — lookup returns 'not_found'.  │
 * └───────────┴────────────────────────────────────────────────────────────┘
 *
 * MC numbers mirror the DOT suffix (MC 500001 ↔ DOT 1000001, etc.) so either
 * lookup path is reproducible from the same table.
 */
export const FMCSA_MOCK_DOT_CLEAN = '1000001'
export const FMCSA_MOCK_DOT_NAME_MISMATCH = '1000002'
export const FMCSA_MOCK_DOT_NO_AUTHORITY = '1000003'
export const FMCSA_MOCK_DOT_NO_INSURANCE = '1000004'
export const FMCSA_MOCK_DOT_NOT_FOUND = '1000005'

const FIXTURES: Record<string, FmcsaCarrierSnapshot> = {
  [FMCSA_MOCK_DOT_CLEAN]: {
    dotNumber: FMCSA_MOCK_DOT_CLEAN,
    mcNumber: '500001',
    legalName: 'Summit Heavy Haul LLC',
    dbaName: 'Summit Heavy Haul',
    allowedToOperate: true,
    dotStatus: 'A',
    operatingAuthority: 'active',
    safetyRating: 'S',
    insuranceOnFile: true,
    insuranceRequiredCents: 75_000_00,
    powerUnits: 12,
    drivers: 15,
    addressState: 'TX',
    outOfServiceDate: null,
  },
  [FMCSA_MOCK_DOT_NAME_MISMATCH]: {
    dotNumber: FMCSA_MOCK_DOT_NAME_MISMATCH,
    mcNumber: '500002',
    legalName: 'Summit Heavy Haul Logistics Incorporated',
    dbaName: 'Summit Logistics',
    allowedToOperate: true,
    dotStatus: 'A',
    operatingAuthority: 'active',
    safetyRating: 'S',
    insuranceOnFile: true,
    insuranceRequiredCents: 75_000_00,
    powerUnits: 8,
    drivers: 9,
    addressState: 'OK',
    outOfServiceDate: null,
  },
  [FMCSA_MOCK_DOT_NO_AUTHORITY]: {
    dotNumber: FMCSA_MOCK_DOT_NO_AUTHORITY,
    mcNumber: '500003',
    legalName: 'Lonestar Flatbed Carriers Inc',
    // dbaName intentionally absent — exercises the "field missing" path.
    allowedToOperate: false,
    dotStatus: 'I',
    operatingAuthority: 'none',
    safetyRating: null,
    insuranceOnFile: false,
    insuranceRequiredCents: null,
    powerUnits: 3,
    drivers: 3,
    addressState: 'LA',
    outOfServiceDate: '2025-02-14',
  },
  [FMCSA_MOCK_DOT_NO_INSURANCE]: {
    dotNumber: FMCSA_MOCK_DOT_NO_INSURANCE,
    mcNumber: '500004',
    legalName: 'Redline Transport Co',
    dbaName: 'Redline Transport',
    allowedToOperate: true,
    dotStatus: 'A',
    operatingAuthority: 'active',
    safetyRating: 'C',
    insuranceOnFile: false,
    insuranceRequiredCents: 100_000_00,
    powerUnits: 5,
    drivers: 6,
    addressState: 'AZ',
    outOfServiceDate: null,
  },
}

const MC_TO_DOT: Record<string, string> = Object.fromEntries(
  Object.values(FIXTURES).map((snapshot) => [snapshot.mcNumber as string, snapshot.dotNumber]),
)

export class MockFmcsaAdapter implements FmcsaProvider {
  readonly name = PROVIDER_NAME

  async lookupByDot(dot: string): Promise<FmcsaLookupResult> {
    const fixture = FIXTURES[dot]
    if (!fixture) {
      return providerFailure(PROVIDER_NAME, {
        code: 'not_found',
        message: `No mock FMCSA record for DOT ${dot}`,
        retryable: false,
      })
    }
    return providerSuccess(PROVIDER_NAME, fixture, {
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      rawReference: `mock-fmcsa-${dot}`,
    })
  }

  async lookupByMc(mc: string): Promise<FmcsaLookupResult> {
    const dot = MC_TO_DOT[mc]
    if (!dot) {
      return providerFailure(PROVIDER_NAME, {
        code: 'not_found',
        message: `No mock FMCSA record for MC ${mc}`,
        retryable: false,
      })
    }
    return this.lookupByDot(dot)
  }
}
