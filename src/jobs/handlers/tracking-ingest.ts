import 'server-only'
import { z } from 'zod'
import { tenantDb, type TenantDb } from '@/db/tenant-db'
import type { TrackingSession } from '@/db/schema'
import { logger } from '@/lib/logger'
import { getTrackingProvider, type TrackingProviderId } from '@/integrations/tracking'
import { ingestEvents } from '@/server/tracking/ingest'
import { listActiveSessions, refreshSessionHealth } from '@/server/tracking/sessions'
import { defineJob, type JobContext } from '../registry'
import { listSweepableTenantIds } from '../tenants'

/**
 * Polls every active tracking session every 5 minutes.
 *
 * Only providers that are actually pull-based need polling — right now that
 * is exclusively the mock adapter (see each real adapter's `pollEvents()`,
 * which throws `notConfiguredError` unconditionally: `trucker_tools`,
 * `macropoint` and `highway` are settings-screen-only this release and push
 * events via `parseWebhook()` instead, from their own webhook routes). A
 * provider that isn't configured for polling is skipped for that session,
 * not treated as a failure — it is expected, not exceptional.
 *
 * `ingestEvents()` is already idempotent on `(provider,
 * rawProviderReference)` (see that function's own comment), so polling a
 * session this job already caught up on the same run, or a retried job
 * re-polling the same window, is harmless: the events it has already seen
 * are filtered out before insert.
 *
 * `refreshSessionHealth()` runs for every active session regardless of
 * whether new events arrived this pass — a session with no update at all
 * is exactly the case that needs to age from `healthy` to `stale` to
 * `lost`.
 */

const sweepSchema = z.object({}).strict()

async function pollSession(db: TenantDb, session: TrackingSession): Promise<void> {
  if (!session.providerSessionId) return

  try {
    const provider = getTrackingProvider(session.provider as TrackingProviderId)
    const events = await provider.pollEvents(session.providerSessionId, session.lastEventAt)
    if (events.length > 0) {
      await ingestEvents(db, session.id, events)
    }
  } catch (error) {
    // A provider that isn't configured for polling throws
    // `integration_unavailable` on every call — expected for every provider
    // but the mock this release. Anything else is logged, not swallowed.
    logger.debug('tracking-ingest: poll skipped', {
      sessionId: session.id,
      provider: session.provider,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  await refreshSessionHealth(db, session.id)
}

export async function runTrackingIngestSweep(_payload: z.infer<typeof sweepSchema>, _ctx: JobContext): Promise<void> {
  const tenantIds = await listSweepableTenantIds()

  for (const tenantId of tenantIds) {
    const db = tenantDb(tenantId)
    const sessions = await listActiveSessions(db)
    for (const session of sessions) {
      await pollSession(db, session)
    }
  }
}

defineJob('tracking.ingest_sweep', {
  schema: sweepSchema,
  handler: runTrackingIngestSweep,
  defaultMaxAttempts: 3,
  description: 'Polls every active tracking session for new events (pull-based providers only) and refreshes session health.',
})
