import 'server-only'
import { z } from 'zod'
import { and, isNull, lte } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { publicTrackingLinks } from '@/db/schema'
import { logger } from '@/lib/logger'
import { defineJob, type JobContext } from '../registry'
import { listSweepableTenantIds } from '../tenants'

/**
 * Hourly public tracking link expiry.
 *
 * `resolvePublicTrackingLink` already refuses any link past its own
 * `expiresAt` at resolve time — see `public-links.ts`'s own comment — so
 * expiry is correctly enforced with or without this job. What this job adds
 * is making an expired link's `revokedAt` reflect reality: it stamps every
 * link that is past `expiresAt` and not already revoked, which is what lets
 * an admin's "active links" list (anything filtered on `revokedAt IS NULL`)
 * stop showing a link nobody can actually use anymore. Idempotent and safe
 * to run every 5 minutes or once a day: a link already stamped is excluded
 * by the same `isNull(revokedAt)` predicate on the next run.
 */

const sweepSchema = z.object({}).strict()

export async function expirePublicTrackingLinks(_payload: z.infer<typeof sweepSchema>, _ctx: JobContext): Promise<void> {
  const now = new Date()
  const tenantIds = await listSweepableTenantIds()

  for (const tenantId of tenantIds) {
    const db = tenantDb(tenantId)
    const expired = await db.updateWhere(
      publicTrackingLinks,
      and(lte(publicTrackingLinks.expiresAt, now), isNull(publicTrackingLinks.revokedAt))!,
      { revokedAt: now },
    )
    if (expired.length > 0) {
      logger.info('jobs: expired public tracking links', { tenantId, count: expired.length })
    }
  }
}

defineJob('tracking.link_expiry_sweep', {
  schema: sweepSchema,
  handler: expirePublicTrackingLinks,
  defaultMaxAttempts: 3,
  description: 'Hourly sweep: marks public tracking links past their TTL as revoked.',
})
