import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { integrationConnections, type IntegrationConnection } from '@/db/schema'
import { notFound } from '@/lib/errors'
import { encryptField } from '@/lib/crypto'
import { serverEnv } from '@/lib/env'

/**
 * Per-tenant integration connections, across every category the settings
 * screen shows (tracking, maps, fmcsa, ocr, email, sms, payments, tolls).
 * Credentials are sealed with `encryptField` and never leave this module in
 * plaintext — `IntegrationConnectionSummary` carries only `hasCredentials`,
 * a boolean, never the secret itself.
 *
 * This module owns the generic connection CRUD; it does not implement any
 * provider's actual API calls (that lives in `src/integrations/**`, owned
 * per-family). `testConnection` calls into the mock adapters where doing so
 * is safe and meaningful, and is honest — `notVerifiable`, never a fabricated
 * `ok: true` — everywhere else.
 */

export type IntegrationCategory = 'tracking' | 'maps' | 'fmcsa' | 'ocr' | 'email' | 'sms' | 'payments' | 'tolls'

export interface IntegrationCatalogEntry {
  category: IntegrationCategory
  provider: string
  /** True only for a provider this release ships as documented-interface-only (throws `integration_unavailable`). */
  interfaceOnly: boolean
  /** The driver env var this provider corresponds to, shown so an operator can see what actually decides runtime behaviour. */
  driverEnvVar: string
}

/**
 * The fixed set of providers each category can be configured with. Not
 * every entry here is wired end-to-end by the tracking/routing domain this
 * agent owns — `interfaceOnly` is asserted only for the three tracking
 * providers and TollGuru, which this codebase's own adapters document as
 * unimplemented; every other category's actual completeness is that
 * domain's to state, so this list neither claims nor denies it.
 */
export const INTEGRATION_CATALOG: IntegrationCatalogEntry[] = [
  { category: 'tracking', provider: 'mock', interfaceOnly: false, driverEnvVar: 'TRACKING_DEFAULT_PROVIDER' },
  { category: 'tracking', provider: 'trucker_tools', interfaceOnly: true, driverEnvVar: 'TRACKING_DEFAULT_PROVIDER' },
  { category: 'tracking', provider: 'macropoint', interfaceOnly: true, driverEnvVar: 'TRACKING_DEFAULT_PROVIDER' },
  { category: 'tracking', provider: 'highway', interfaceOnly: true, driverEnvVar: 'TRACKING_DEFAULT_PROVIDER' },
  { category: 'maps', provider: 'mock', interfaceOnly: false, driverEnvVar: 'GEO_DRIVER' },
  { category: 'maps', provider: 'google', interfaceOnly: false, driverEnvVar: 'GEO_DRIVER' },
  { category: 'tolls', provider: 'tollguru', interfaceOnly: true, driverEnvVar: 'n/a' },
  { category: 'fmcsa', provider: 'mock', interfaceOnly: false, driverEnvVar: 'FMCSA_DRIVER' },
  { category: 'fmcsa', provider: 'qcmobile', interfaceOnly: false, driverEnvVar: 'FMCSA_DRIVER' },
  { category: 'ocr', provider: 'mock', interfaceOnly: false, driverEnvVar: 'OCR_DRIVER' },
  { category: 'ocr', provider: 'textract', interfaceOnly: false, driverEnvVar: 'OCR_DRIVER' },
  { category: 'ocr', provider: 'docai', interfaceOnly: false, driverEnvVar: 'OCR_DRIVER' },
  { category: 'email', provider: 'mock', interfaceOnly: false, driverEnvVar: 'EMAIL_DRIVER' },
  { category: 'email', provider: 'mailgun', interfaceOnly: false, driverEnvVar: 'EMAIL_DRIVER' },
  { category: 'sms', provider: 'mock', interfaceOnly: false, driverEnvVar: 'SMS_DRIVER' },
  { category: 'sms', provider: 'twilio', interfaceOnly: false, driverEnvVar: 'SMS_DRIVER' },
  { category: 'payments', provider: 'mock', interfaceOnly: false, driverEnvVar: 'STRIPE_DRIVER' },
  { category: 'payments', provider: 'live', interfaceOnly: false, driverEnvVar: 'STRIPE_DRIVER' },
]

const ACTIVE_DRIVER_BY_CATEGORY: () => Partial<Record<IntegrationCategory, string>> = () => {
  const env = serverEnv()
  return {
    tracking: env.TRACKING_DEFAULT_PROVIDER,
    maps: env.GEO_DRIVER,
    fmcsa: env.FMCSA_DRIVER,
    ocr: env.OCR_DRIVER,
    email: env.EMAIL_DRIVER,
    sms: env.SMS_DRIVER,
    payments: env.STRIPE_DRIVER,
    tolls: 'tollguru',
  }
}

export interface IntegrationConnectionSummary {
  id: string | null
  category: IntegrationCategory
  provider: string
  displayName: string | null
  enabled: boolean
  hasCredentials: boolean
  healthStatus: string
  lastCheckedAt: Date | null
  lastErrorMessage: string | null
  config: Record<string, unknown>
  interfaceOnly: boolean
  /** Whether this provider is the one this environment's driver env var actually selects at runtime. */
  isActiveDriver: boolean
}

function toSummary(entry: IntegrationCatalogEntry, row: IntegrationConnection | null, isActiveDriver: boolean): IntegrationConnectionSummary {
  return {
    id: row?.id ?? null,
    category: entry.category,
    provider: entry.provider,
    displayName: row?.displayName ?? null,
    enabled: row?.enabled ?? false,
    hasCredentials: Boolean(row?.credentialsEncrypted),
    healthStatus: row?.healthStatus ?? 'unknown',
    lastCheckedAt: row?.lastCheckedAt ?? null,
    lastErrorMessage: row?.lastErrorMessage ?? null,
    config: row?.config ?? {},
    interfaceOnly: entry.interfaceOnly,
    isActiveDriver,
  }
}

/** Every provider in the catalog, merged with this tenant's saved connection row (if any) — drives the settings screen's cards. */
export async function listIntegrationConnections(db: TenantDb): Promise<IntegrationConnectionSummary[]> {
  const rows = await db.findMany(integrationConnections)
  const byKey = new Map(rows.map((row) => [`${row.category}:${row.provider}`, row]))
  const activeDrivers = ACTIVE_DRIVER_BY_CATEGORY()

  return INTEGRATION_CATALOG.map((entry) =>
    toSummary(entry, byKey.get(`${entry.category}:${entry.provider}`) ?? null, activeDrivers[entry.category] === entry.provider),
  )
}

export interface UpsertIntegrationConnectionInput {
  category: IntegrationCategory
  provider: string
  displayName?: string | null
  enabled?: boolean
  /** Plaintext credentials, sealed with `encryptField` before storage — never returned to any caller. */
  credentials?: Record<string, string> | null
  config?: Record<string, unknown>
}

export async function upsertIntegrationConnection(
  db: TenantDb,
  input: UpsertIntegrationConnectionInput,
): Promise<IntegrationConnectionSummary> {
  const existing = await db.findFirst(integrationConnections, {
    where: and(eq(integrationConnections.category, input.category), eq(integrationConnections.provider, input.provider))!,
  })

  const credentialsEncrypted = input.credentials
    ? encryptField(JSON.stringify(input.credentials))
    : existing?.credentialsEncrypted ?? null

  const row = existing
    ? await db.update(integrationConnections, existing.id, {
        displayName: input.displayName !== undefined ? input.displayName : existing.displayName,
        enabled: input.enabled ?? existing.enabled,
        credentialsEncrypted,
        config: input.config ?? existing.config,
      })
    : await db.insert(integrationConnections, {
        category: input.category,
        provider: input.provider,
        displayName: input.displayName ?? null,
        enabled: input.enabled ?? false,
        credentialsEncrypted,
        config: input.config ?? {},
        healthStatus: 'unknown',
      })

  if (!row) throw notFound('errors.notFound', { entity: 'integrationConnection' })

  const entry = INTEGRATION_CATALOG.find((e) => e.category === input.category && e.provider === input.provider)
  const activeDrivers = ACTIVE_DRIVER_BY_CATEGORY()
  return toSummary(
    entry ?? { category: input.category, provider: input.provider, interfaceOnly: false, driverEnvVar: 'n/a' },
    row,
    activeDrivers[input.category] === input.provider,
  )
}

export interface TestConnectionResult {
  ok: boolean
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'failing'
  messageKey: string
  interfaceOnly: boolean
}

/**
 * Honest health check. `mock` providers always report healthy (they are
 * guaranteed to work offline, by the architecture's own design); the
 * documented interface-only providers always report the same
 * "not wired this release" result rather than a fabricated success or a
 * disabled "coming soon" badge; everything else reports `notVerifiable`
 * this domain has no adapter to actually call.
 */
export async function testConnection(db: TenantDb, category: IntegrationCategory, provider: string): Promise<TestConnectionResult> {
  const entry = INTEGRATION_CATALOG.find((e) => e.category === category && e.provider === provider)
  const existing = await db.findFirst(integrationConnections, {
    where: and(eq(integrationConnections.category, category), eq(integrationConnections.provider, provider))!,
  })

  let result: TestConnectionResult
  if (provider === 'mock') {
    result = { ok: true, healthStatus: 'healthy', messageKey: 'tracking.integrations.testResult.mockHealthy', interfaceOnly: false }
  } else if (entry?.interfaceOnly) {
    result = { ok: false, healthStatus: 'failing', messageKey: 'tracking.integrations.testResult.interfaceOnly', interfaceOnly: true }
  } else if (!existing?.credentialsEncrypted) {
    result = { ok: false, healthStatus: 'unknown', messageKey: 'tracking.integrations.testResult.noCredentials', interfaceOnly: false }
  } else {
    result = { ok: false, healthStatus: 'unknown', messageKey: 'tracking.integrations.testResult.notVerifiable', interfaceOnly: false }
  }

  if (existing) {
    await db.update(integrationConnections, existing.id, {
      healthStatus: result.healthStatus,
      lastCheckedAt: new Date(),
      lastErrorMessage: result.ok ? null : result.messageKey,
    })
  }

  return result
}
