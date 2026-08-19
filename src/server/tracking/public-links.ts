import 'server-only'
import { and, desc, eq, isNull, lte } from 'drizzle-orm'
import { tenantDb, type TenantDb } from '@/db/tenant-db'
import {
  carriers,
  loadStops,
  loads,
  publicTrackingLinks,
  tenantSettings,
  trackingSessions,
  type LoadStop,
  type PublicTrackingLink,
} from '@/db/schema'
import { AppError, forbidden, notFound, validationFailed } from '@/lib/errors'
import { generateToken, hashToken } from '@/lib/crypto'
import { checkRateLimit } from '@/lib/rate-limit'
import { getTenant } from '@/server/context'

/**
 * Public customer tracking links.
 *
 * The raw token is `{tenantId}.{secret}` — the tenant id is not itself
 * secret (it is a UUID visible in the URL, no more sensitive than a
 * subdomain), and putting it in the token is what lets resolution stay
 * entirely inside `tenantDb()`: the token names its own tenant, so
 * `resolvePublicTrackingLink` never needs a cross-tenant query (and this
 * module, like every other one in `src/server/tracking/**`, may not import
 * `unsafeDb`). Only the SHA-256 hash of the *whole* raw token is ever
 * stored (`hashToken`) — a stolen database row can never be replayed as a
 * token, and a guessed tenant id without the secret resolves nothing.
 *
 * The projection returned by `resolvePublicTrackingLink` is deliberately
 * narrow: load reference, origin/destination city+state, current status,
 * last known position and ETA, stop-level scheduled windows, and a tenant
 * display name. No rates, no carrier DOT/MC or address, no driver name or
 * phone, no documents.
 */

const RESOLVE_RATE_LIMIT = { limit: 30, windowSeconds: 60 * 60 }

function buildRawToken(tenantId: string, secret: string): string {
  return `${tenantId}.${secret}`
}

function parseRawToken(rawToken: string): { tenantId: string } | null {
  const separator = rawToken.indexOf('.')
  if (separator <= 0) return null
  const tenantId = rawToken.slice(0, separator)
  const secret = rawToken.slice(separator + 1)
  if (!tenantId || !secret) return null
  return { tenantId }
}

export interface CreatePublicTrackingLinkInput {
  loadId: string
  label?: string | null
  recipientEmail?: string | null
  /** Overrides the tenant's `publicTrackingTokenTtlHours` setting when provided. */
  ttlHours?: number
  createdByUserId?: string | null
}

export interface CreatePublicTrackingLinkResult {
  link: PublicTrackingLink
  /** The only time the raw token is ever available — persist/copy it now. */
  rawToken: string
}

export async function createPublicTrackingLink(
  db: TenantDb,
  input: CreatePublicTrackingLinkInput,
): Promise<CreatePublicTrackingLinkResult> {
  await db.requireById(loads, input.loadId, 'load')

  const settings = await db.findFirst(tenantSettings, { where: eq(tenantSettings.tenantId, db.tenantId) })
  if (settings && settings.publicTrackingEnabled === false) {
    throw new AppError('forbidden', 'tracking.errors.publicTrackingDisabled')
  }

  const ttlHours = input.ttlHours ?? settings?.publicTrackingTokenTtlHours ?? 72
  if (ttlHours <= 0) throw validationFailed('validation.positive')

  const secret = generateToken(32)
  const rawToken = buildRawToken(db.tenantId, secret)

  const link = await db.insert(publicTrackingLinks, {
    loadId: input.loadId,
    tokenHash: hashToken(rawToken),
    label: input.label ?? null,
    recipientEmail: input.recipientEmail ?? null,
    expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
    createdByUserId: input.createdByUserId ?? null,
  })

  return { link, rawToken }
}

export async function listPublicTrackingLinksForLoad(db: TenantDb, loadId: string): Promise<PublicTrackingLink[]> {
  return db.findMany(publicTrackingLinks, {
    where: eq(publicTrackingLinks.loadId, loadId),
    orderBy: desc(publicTrackingLinks.createdAt),
  })
}

export async function revokePublicTrackingLink(db: TenantDb, linkId: string): Promise<PublicTrackingLink> {
  const updated = await db.update(publicTrackingLinks, linkId, { revokedAt: new Date() })
  if (!updated) throw notFound('errors.notFound', { entity: 'publicTrackingLink' })
  return updated
}

/**
 * Expiry sweep target for a scheduled job. Expiry itself is enforced at
 * resolve time (a link past `expiresAt` simply fails to resolve), so this
 * only reports a count for observability/alerting — nothing needs to
 * "expire" a row for the product to behave correctly.
 */
export async function countExpiredLinks(db: TenantDb): Promise<number> {
  return db.count(
    publicTrackingLinks,
    and(lte(publicTrackingLinks.expiresAt, new Date()), isNull(publicTrackingLinks.revokedAt))!,
  )
}

/* ── Public projection ───────────────────────────────────────────────────── */

export interface PublicStopProjection {
  stopType: 'pickup' | 'delivery'
  city: string | null
  state: string | null
  timezone: string
  windowStart: Date | null
  windowEnd: Date | null
  actualArrivalAt: Date | null
  actualDepartureAt: Date | null
}

export interface PublicTrackingProjection {
  tenantDisplayName: string
  loadNumber: string
  carrierDisplayName: string | null
  status: string
  originCity: string | null
  originState: string | null
  destinationCity: string | null
  destinationState: string | null
  stops: PublicStopProjection[]
  lastKnownLatitude: number | null
  lastKnownLongitude: number | null
  lastKnownLocationLabel: string | null
  etaAt: Date | null
  routeProgressPercent: number | null
  lastUpdatedAt: Date | null
  viewCount: number
}

function projectStop(stop: LoadStop): PublicStopProjection {
  return {
    stopType: stop.stopType,
    city: stop.city,
    state: stop.state,
    timezone: stop.timezone,
    windowStart: stop.windowStart,
    windowEnd: stop.windowEnd,
    actualArrivalAt: stop.actualArrivalAt,
    actualDepartureAt: stop.actualDepartureAt,
  }
}

/**
 * The exact, fixed key set of `PublicTrackingProjection` — kept as a runtime
 * array (not just the TypeScript interface) so `tests/unit/tracking`'s
 * privacy test can assert on it directly: no rate, no carrier DOT/MC or
 * address, no driver name or phone, no documents can ever leak through this
 * function without that test failing.
 */
export const PUBLIC_TRACKING_PROJECTION_KEYS = [
  'tenantDisplayName',
  'loadNumber',
  'carrierDisplayName',
  'status',
  'originCity',
  'originState',
  'destinationCity',
  'destinationState',
  'stops',
  'lastKnownLatitude',
  'lastKnownLongitude',
  'lastKnownLocationLabel',
  'etaAt',
  'routeProgressPercent',
  'lastUpdatedAt',
  'viewCount',
] as const satisfies readonly (keyof PublicTrackingProjection)[]

/**
 * Pure projection builder — every DB read happens in `resolvePublicTrackingLink`;
 * this function only shapes already-fetched rows into the narrow public
 * contract, which is what makes it unit-testable without a database.
 */
export function buildPublicTrackingProjection(input: {
  tenantDisplayName: string
  load: { loadNumber: string; status: string; carrierId: string | null }
  carrier: { dba: string | null; legalName: string } | null
  stops: LoadStop[]
  latestSession: {
    lastLatitude: string | null
    lastLongitude: string | null
    lastLocationLabel: string | null
    etaAt: Date | null
    routeProgressPercent: number | null
    lastEventAt: Date | null
  } | null
  viewCount: number
}): PublicTrackingProjection {
  const orderedStops = input.stops.slice().sort((a, b) => a.sequence - b.sequence)
  const origin = orderedStops[0] ?? null
  const destination = orderedStops[orderedStops.length - 1] ?? null
  const { latestSession } = input

  return {
    tenantDisplayName: input.tenantDisplayName,
    loadNumber: input.load.loadNumber,
    carrierDisplayName: input.carrier ? input.carrier.dba ?? input.carrier.legalName : null,
    status: input.load.status,
    originCity: origin?.city ?? null,
    originState: origin?.state ?? null,
    destinationCity: destination?.city ?? null,
    destinationState: destination?.state ?? null,
    stops: orderedStops.map(projectStop),
    lastKnownLatitude: latestSession?.lastLatitude != null ? Number(latestSession.lastLatitude) : null,
    lastKnownLongitude: latestSession?.lastLongitude != null ? Number(latestSession.lastLongitude) : null,
    lastKnownLocationLabel: latestSession?.lastLocationLabel ?? null,
    etaAt: latestSession?.etaAt ?? null,
    routeProgressPercent: latestSession?.routeProgressPercent ?? null,
    lastUpdatedAt: latestSession?.lastEventAt ?? null,
    viewCount: input.viewCount,
  }
}

/**
 * Resolves a raw token to the narrow public projection. There is no
 * `Actor` here at all — a customer has no account — so the token's own
 * `{tenantId}.{secret}` shape is what routes this to the right
 * `tenantDb()`; a token minted for tenant A can only ever resolve inside
 * tenant A's scope, so it structurally cannot resolve tenant B's load.
 */
export async function resolvePublicTrackingLink(
  rawToken: string,
  requesterIp: string | null,
): Promise<PublicTrackingProjection> {
  const parsed = parseRawToken(rawToken)
  if (!parsed) throw notFound('tracking.errors.linkNotFound')

  if (requesterIp) {
    const rate = await checkRateLimit({ key: `public-tracking-link:${requesterIp}`, ...RESOLVE_RATE_LIMIT })
    if (!rate.allowed) throw new AppError('rate_limited', 'errors.rateLimited')
  }

  const db = tenantDb(parsed.tenantId)
  const tokenHash = hashToken(rawToken)

  const link = await db.findFirst(publicTrackingLinks, { where: eq(publicTrackingLinks.tokenHash, tokenHash) })
  if (!link) throw notFound('tracking.errors.linkNotFound')
  if (link.revokedAt) throw forbidden('tracking.errors.linkRevoked')
  if (link.expiresAt.getTime() <= Date.now()) throw forbidden('tracking.errors.linkExpired')

  const [tenant, load, stops, sessions] = await Promise.all([
    getTenant(parsed.tenantId),
    db.findById(loads, link.loadId),
    db.findMany(loadStops, { where: eq(loadStops.loadId, link.loadId) }),
    db.findMany(trackingSessions, { where: eq(trackingSessions.loadId, link.loadId) }),
  ])
  if (!tenant || !load) throw notFound('tracking.errors.linkNotFound')

  const carrier = load.carrierId ? await db.findById(carriers, load.carrierId) : null

  const latestSession =
    sessions.slice().sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))[0] ?? null

  await db.update(publicTrackingLinks, link.id, { viewCount: link.viewCount + 1, lastViewedAt: new Date() })

  return buildPublicTrackingProjection({
    tenantDisplayName: tenant.displayName,
    load,
    carrier,
    stops,
    latestSession,
    viewCount: link.viewCount + 1,
  })
}
