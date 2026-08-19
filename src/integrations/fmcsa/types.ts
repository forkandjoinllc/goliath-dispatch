import type { ProviderResult } from '../_shared/provider'

export type OperatingAuthorityStatus = 'active' | 'inactive' | 'none'

/**
 * Provider-independent projection of a carrier's FMCSA standing. Every field
 * except `dotNumber` is optional — the QCMobile API's shape varies release to
 * release and fields routinely go missing for small/inactive carriers.
 */
export interface FmcsaCarrierSnapshot {
  dotNumber: string
  mcNumber?: string
  legalName?: string
  dbaName?: string
  allowedToOperate?: boolean
  dotStatus?: string
  operatingAuthority?: OperatingAuthorityStatus
  safetyRating?: string | null
  insuranceOnFile?: boolean
  insuranceRequiredCents?: number | null
  powerUnits?: number | null
  drivers?: number | null
  addressState?: string | null
  outOfServiceDate?: string | null
}

export type FmcsaLookupResult = ProviderResult<FmcsaCarrierSnapshot>
