import 'server-only'
import { count, eq, isNull, sql } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { documentVersions, equipmentMedia, jobQueue, stripeEvents, tenants } from '@/db/schema'

/**
 * Platform health and usage — the read model for `app/platform/health`.
 * Every figure here is either a `count(*)`/`sum(*)` aggregate or a single
 * `max()`/`min()` scan; nothing here does per-row application logic, so it
 * stays cheap even as the platform grows.
 */

export interface TenantsByStatus {
  status: string
  count: number
}

export async function tenantsByStatus(): Promise<TenantsByStatus[]> {
  const rows = await unsafeDb
    .select({ status: tenants.status, value: count() })
    .from(tenants)
    .groupBy(tenants.status)
  return rows.map((r) => ({ status: r.status, count: r.value }))
}

export interface JobQueueHealth {
  queued: number
  running: number
  failed: number
  deadLetter: number
  oldestQueuedAt: Date | null
}

export async function jobQueueHealth(): Promise<JobQueueHealth> {
  const rows = await unsafeDb
    .select({ status: jobQueue.status, value: count() })
    .from(jobQueue)
    .groupBy(jobQueue.status)
  const byStatus = new Map(rows.map((r) => [r.status, r.value]))

  const [oldest] = await unsafeDb
    .select({ runAt: jobQueue.runAt })
    .from(jobQueue)
    .where(eq(jobQueue.status, 'queued'))
    .orderBy(jobQueue.runAt)
    .limit(1)

  return {
    queued: byStatus.get('queued') ?? 0,
    running: byStatus.get('running') ?? 0,
    failed: byStatus.get('failed') ?? 0,
    deadLetter: byStatus.get('dead_letter') ?? 0,
    oldestQueuedAt: oldest?.runAt ?? null,
  }
}

export interface WebhookHealth {
  received: number
  processed: number
  failed: number
  /** Median lag in seconds between receipt and processing, over processed events. */
  avgProcessingLagSeconds: number | null
}

export async function webhookHealth(): Promise<WebhookHealth> {
  const rows = await unsafeDb
    .select({ status: stripeEvents.processingStatus, value: count() })
    .from(stripeEvents)
    .groupBy(stripeEvents.processingStatus)
  const byStatus = new Map(rows.map((r) => [r.status, r.value]))

  const [lag] = await unsafeDb
    .select({
      avgSeconds: sql<number | null>`avg(extract(epoch from (${stripeEvents.processedAt} - ${stripeEvents.createdAt})))`,
    })
    .from(stripeEvents)
    .where(sql`${stripeEvents.processedAt} is not null`)

  return {
    received: byStatus.get('received') ?? 0,
    processed: byStatus.get('processed') ?? 0,
    failed: byStatus.get('failed') ?? 0,
    avgProcessingLagSeconds: lag?.avgSeconds != null ? Math.round(Number(lag.avgSeconds)) : null,
  }
}

export interface StorageUsage {
  documentBytes: number
  mediaBytes: number
  totalBytes: number
}

/** Cheaply derived from the byte-size columns already recorded at upload time — no bucket listing. */
export async function storageUsage(): Promise<StorageUsage> {
  const [documentTotal] = await unsafeDb
    .select({ total: sql<number | null>`sum(${documentVersions.byteSize})` })
    .from(documentVersions)
    .where(isNull(documentVersions.deletedAt))
  const [mediaTotal] = await unsafeDb
    .select({ total: sql<number | null>`sum(${equipmentMedia.byteSize})` })
    .from(equipmentMedia)
    .where(isNull(equipmentMedia.deletedAt))

  const documentBytes = Number(documentTotal?.total ?? 0)
  const mediaBytes = Number(mediaTotal?.total ?? 0)
  return { documentBytes, mediaBytes, totalBytes: documentBytes + mediaBytes }
}
