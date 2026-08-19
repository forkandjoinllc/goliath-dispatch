import 'server-only'
import { and, eq } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'
import { unsafeDb } from '@/db/client'
import { trackingSessions } from '@/db/schema'
import { tenantDb } from '@/db/tenant-db'
import { getTrackingProvider, type NormalizedTrackingEvent, type TrackingProviderId } from '@/integrations/tracking'
import { ingestEvents } from '@/server/tracking/ingest'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'

/**
 * Tracking provider webhook intake.
 *
 * Three of the four supported providers (`trucker_tools`, `macropoint`,
 * `highway`) are interface-only this release — every method on their
 * adapters throws `integration_unavailable` (see each adapter's header
 * comment in `src/integrations/tracking/`) — and the mock provider is
 * pull-based (`advance()`, driven by the dev simulator action), not
 * webhook-driven. So this route is complete and correct against the
 * documented contract, but will only ever be exercised by a synthetic
 * request in this release's tests, never a live delivery.
 *
 * Contract: verify the provider's signature via `parseWebhook`, dedupe on
 * the provider's own event id (`rawProviderReference`, enforced by
 * `ingestEvents`'s idempotency against the unique index on
 * `tracking_events`), hand off to `ingestEvents`, and answer with the
 * status a webhook sender expects — 200 for anything already applied
 * (including "provider not configured": retrying changes nothing), 400/404
 * for a request this endpoint will never accept no matter how many times
 * it is retried, and 500 for a genuine transient failure so the provider's
 * retry/backoff kicks in.
 *
 * A webhook payload identifies a provider-side session, not a tenant, so —
 * like `webhooks/stripe/route.ts` — this route (inside the
 * `src/app/api/**` ESLint exemption) resolves the session's tenant via
 * `unsafeDb` directly. `ingestEvents` itself never receives anything but a
 * tenant-scoped `TenantDb`; nothing downstream of this lookup is exempt.
 */

export const runtime = 'nodejs'

const SUPPORTED_PROVIDERS = new Set(['mock', 'trucker_tools', 'macropoint', 'highway'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await params
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'unknown_provider' }, { status: 404 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-webhook-signature')

  let payload: unknown
  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  let events: NormalizedTrackingEvent[]
  try {
    events = await getTrackingProvider(provider as TrackingProviderId).parseWebhook(payload, signature)
  } catch (error) {
    if (isAppError(error) && error.code === 'integration_unavailable') {
      // Documented as unimplemented this release — nothing a retry fixes.
      logger.info('tracking webhook: provider not configured', { provider })
      return NextResponse.json({ received: true, status: 'not_configured' })
    }
    logger.warn('tracking webhook: signature/payload rejected', { provider, error })
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }

  if (events.length === 0) {
    return NextResponse.json({ received: true, status: 'ignored' })
  }

  const byProviderSessionId = new Map<string, NormalizedTrackingEvent[]>()
  for (const event of events) {
    const bucket = byProviderSessionId.get(event.sessionId) ?? []
    bucket.push(event)
    byProviderSessionId.set(event.sessionId, bucket)
  }

  let ingestedTotal = 0
  let duplicateTotal = 0

  for (const [providerSessionId, sessionEvents] of byProviderSessionId) {
    const session = await unsafeDb.query.trackingSessions.findFirst({
      where: and(
        eq(trackingSessions.provider, provider as TrackingProviderId),
        eq(trackingSessions.providerSessionId, providerSessionId),
      ),
    })
    if (!session) {
      // A session this webhook refers to does not exist in any tenant —
      // not retryable, no amount of resending creates it.
      logger.warn('tracking webhook: unknown session', { provider, providerSessionId })
      continue
    }

    try {
      const db = tenantDb(session.tenantId)
      const result = await ingestEvents(db, session.id, sessionEvents)
      ingestedTotal += result.ingested
      duplicateTotal += result.duplicates
    } catch (error) {
      logger.error('tracking webhook: ingestion failed', { provider, sessionId: session.id, error })
      return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ received: true, ingested: ingestedTotal, duplicates: duplicateTotal })
}
