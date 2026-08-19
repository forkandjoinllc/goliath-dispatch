/**
 * Live adapter for the FMCSA QCMobile API (public carrier census + safety
 * data). Selected only when `FMCSA_DRIVER=qcmobile`; never constructed
 * otherwise (see `./index.ts`).
 *
 * QCMobile is a public-sector API with no formal, versioned schema
 * guarantee: fields are frequently absent for small or long-inactive
 * carriers, numeric fields sometimes arrive as strings, and the shape has
 * changed across FMCSA's own releases. Every field in `RawQcMobileCarrier`
 * is optional and every read goes through a defensive coercion helper —
 * nothing here assumes a field exists.
 */
import { serverEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import { fetchJson, ProviderHttpError } from '../_shared/http'
import { mapProviderError, notConfiguredError } from '../_shared/errors'
import { providerFailure, providerSuccess } from '../_shared/provider'
import type { FmcsaProvider } from './provider'
import type { FmcsaCarrierSnapshot, FmcsaLookupResult, OperatingAuthorityStatus } from './types'

const PROVIDER_NAME = 'fmcsa.qcmobile'
const CACHE_TTL_SECONDS = 60 * 60 * 24 // 24h; the app's own re-verification cadence is 7 days.

/** The QCMobile envelope wraps the payload in `content`; both keys are seen in the wild. */
interface RawQcMobileEnvelope {
  content?: { carrier?: RawQcMobileCarrier } | RawQcMobileCarrier
  carrier?: RawQcMobileCarrier
}

interface RawQcMobileCarrier {
  dotNumber?: number | string
  legalName?: string
  dbaName?: string
  mcNumber?: string | number
  mcMxFfNumber?: string
  allowedToOperate?: string
  statusCode?: string
  safetyRating?: string | null
  oosDate?: string | null
  totalPowerUnits?: number | string | null
  totalDrivers?: number | string | null
  phyState?: string | null
  bipdInsuranceOnFile?: string | null
  bipdInsuranceRequired?: number | string | null
  commonAuthorityStatus?: string | null
  contractAuthorityStatus?: string | null
  brokerAuthorityStatus?: string | null
}

function toStr(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const str = String(value).trim()
  return str.length ? str : undefined
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function toYesNoBool(value: unknown): boolean | undefined {
  const str = toStr(value)?.toUpperCase()
  if (str === 'Y') return true
  if (str === 'N') return false
  return undefined
}

function authorityStatusFrom(value: unknown): 'active' | 'inactive' | undefined {
  const str = toStr(value)?.toUpperCase()
  if (!str) return undefined
  if (str.startsWith('A')) return 'active'
  if (str.startsWith('I') || str.startsWith('N')) return 'inactive'
  return undefined
}

function deriveOperatingAuthority(raw: RawQcMobileCarrier): OperatingAuthorityStatus {
  const statuses = [
    authorityStatusFrom(raw.commonAuthorityStatus),
    authorityStatusFrom(raw.contractAuthorityStatus),
    authorityStatusFrom(raw.brokerAuthorityStatus),
  ].filter((s): s is 'active' | 'inactive' => s !== undefined)

  if (statuses.length === 0) return 'none'
  return statuses.includes('active') ? 'active' : 'inactive'
}

function extractCarrier(envelope: RawQcMobileEnvelope): RawQcMobileCarrier | undefined {
  if (!envelope) return undefined
  if (envelope.carrier) return envelope.carrier
  const content = envelope.content
  if (!content) return undefined
  if ('carrier' in content && content.carrier) return content.carrier
  return content as RawQcMobileCarrier
}

function normalize(dotNumber: string, raw: RawQcMobileCarrier | undefined): FmcsaCarrierSnapshot {
  if (!raw) return { dotNumber }

  return {
    dotNumber: toStr(raw.dotNumber) ?? dotNumber,
    mcNumber: toStr(raw.mcNumber) ?? toStr(raw.mcMxFfNumber),
    legalName: toStr(raw.legalName),
    dbaName: toStr(raw.dbaName),
    allowedToOperate: toYesNoBool(raw.allowedToOperate),
    dotStatus: toStr(raw.statusCode),
    operatingAuthority: deriveOperatingAuthority(raw),
    safetyRating: toStr(raw.safetyRating) ?? null,
    insuranceOnFile: toYesNoBool(raw.bipdInsuranceOnFile),
    insuranceRequiredCents:
      raw.bipdInsuranceRequired === undefined || raw.bipdInsuranceRequired === null
        ? null
        : Math.round(Number(raw.bipdInsuranceRequired) * 100),
    powerUnits: toNumberOrNull(raw.totalPowerUnits),
    drivers: toNumberOrNull(raw.totalDrivers),
    addressState: toStr(raw.phyState) ?? null,
    outOfServiceDate: toStr(raw.oosDate) ?? null,
  }
}

export class QcMobileFmcsaAdapter implements FmcsaProvider {
  readonly name = PROVIDER_NAME

  private readonly webKey: string
  private readonly baseUrl: string

  constructor() {
    const env = serverEnv()
    if (!env.FMCSA_WEBKEY) {
      throw notConfiguredError(PROVIDER_NAME, 'integrations.fmcsa.notConfigured')
    }
    this.webKey = env.FMCSA_WEBKEY
    this.baseUrl = env.FMCSA_BASE_URL.replace(/\/+$/, '')
  }

  async lookupByDot(dot: string): Promise<FmcsaLookupResult> {
    return this.lookup(`${this.baseUrl}/carriers/${encodeURIComponent(dot)}`, dot)
  }

  async lookupByMc(mc: string): Promise<FmcsaLookupResult> {
    return this.lookup(`${this.baseUrl}/carriers/docket-number/${encodeURIComponent(mc)}`, mc)
  }

  private async lookup(baseUrl: string, key: string): Promise<FmcsaLookupResult> {
    const url = `${baseUrl}?webKey=${encodeURIComponent(this.webKey)}`
    try {
      const raw = await fetchJson<RawQcMobileEnvelope>(url, {
        provider: PROVIDER_NAME,
        redactQueryParams: ['webKey'],
      })
      const carrier = extractCarrier(raw)
      if (!carrier) {
        return providerFailure(PROVIDER_NAME, {
          code: 'not_found',
          message: `No FMCSA record found for ${key}`,
          retryable: false,
        })
      }
      const dotNumber = toStr(carrier.dotNumber) ?? key
      return providerSuccess(PROVIDER_NAME, normalize(dotNumber, carrier), {
        cacheTtlSeconds: CACHE_TTL_SECONDS,
        rawReference: dotNumber,
      })
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 404) {
        return providerFailure(PROVIDER_NAME, {
          code: 'not_found',
          message: `No FMCSA record found for ${key}`,
          retryable: false,
        })
      }
      logger.warn('fmcsa qcmobile lookup failed', { provider: PROVIDER_NAME, key })
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.fmcsa.unavailable')
    }
  }
}
