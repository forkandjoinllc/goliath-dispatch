import 'server-only'
import { z } from 'zod'
import { and, isNull } from 'drizzle-orm'
import { tenantDb, type TenantDb } from '@/db/tenant-db'
import { documentExpirations, documents, tenantSettings, trailers, trucks, type Document } from '@/db/schema'
import type { ResourceContext } from '@/lib/permissions'
import { emitNotification } from '@/server/notifications/dispatch'
import { listExpiring, markExpirations } from '@/server/documents/service'
import { defineJob, type JobContext } from '../registry'
import { listSweepableTenantIds } from '../tenants'

/**
 * The daily document-expiration sweep.
 *
 * Idempotent in two independent ways, matching the two things this job must
 * never do twice:
 *   1. Re-running `markExpirations()` the same day inserts nothing new — the
 *      unique index on `(documentId, kind, expirationDate)` plus its own
 *      pre-check make a second materialization pass a no-op (see
 *      `documents/service.ts`'s own comment on that function).
 *   2. A `documentExpirations` row is only ever notified once: this handler
 *      only considers rows with `notifiedAt IS NULL`, and sets `notifiedAt`
 *      in the same pass it calls `emitNotification()` — even if the tenant
 *      has zero eligible recipients, the row is still marked notified so a
 *      re-run never re-attempts it. `emitNotification()`'s own dedupe (keyed
 *      by event + subject + channel + this row's expiration date) is the
 *      second, independent guard against a duplicate notification landing
 *      in a user's inbox even if this handler were ever re-entered mid-row.
 */

const sweepSchema = z.object({}).strict()

async function warningDaysFor(db: TenantDb): Promise<number> {
  const settings = await db.findFirst(tenantSettings)
  return settings?.documentExpirationWarningDays ?? 30
}

/** A document whose expiration date moved (renewed) or that was replaced/removed no longer matches its recorded expirations row. */
async function resolveStaleExpirations(db: TenantDb, now: Date): Promise<number> {
  const unresolved = await db.findMany(documentExpirations, { where: isNull(documentExpirations.resolvedAt) })
  let resolved = 0
  for (const row of unresolved) {
    const document = await db.findById(documents, row.documentId, true)
    const stillMatches =
      document &&
      !document.deletedAt &&
      document.expirationDate &&
      document.expirationDate.getTime() === row.expirationDate.getTime()
    if (!stillMatches) {
      await db.update(documentExpirations, row.id, { resolvedAt: now })
      resolved += 1
    }
  }
  return resolved
}

/** Best-effort resource facts so the right audience (a carrier's own users, an assigned dispatcher) is notified, not only tenant-wide admins. */
async function resourceForDocument(db: TenantDb, document: Document): Promise<ResourceContext> {
  const base: ResourceContext = { tenantId: db.tenantId }
  try {
    switch (document.ownerType) {
      case 'carrier':
        return { ...base, carrierId: document.ownerId }
      case 'truck': {
        const truck = await db.findById(trucks, document.ownerId)
        return { ...base, truckId: document.ownerId, carrierId: truck?.carrierId ?? undefined }
      }
      case 'trailer': {
        const trailer = await db.findById(trailers, document.ownerId)
        return { ...base, trailerId: document.ownerId, carrierId: trailer?.carrierId ?? undefined }
      }
      case 'driver':
        // `drivers` has no direct `carrierId` — the relationship lives in a
        // separate carrier-assignment join table. `driverId` alone still
        // correctly reaches an 'assigned' dispatcher and the driver's own
        // 'own'-scope login (see `resourceInScope` in `lib/permissions/check.ts`).
        return { ...base, driverId: document.ownerId }
      default:
        return base
    }
  } catch {
    return base
  }
}

async function notifyPendingExpirations(db: TenantDb, tenantId: string, now: Date): Promise<{ expiring: number; expired: number }> {
  const pending = await db.findMany(documentExpirations, {
    where: and(isNull(documentExpirations.notifiedAt), isNull(documentExpirations.resolvedAt))!,
  })

  let expiring = 0
  let expired = 0

  for (const row of pending) {
    const document = await db.findById(documents, row.documentId)
    if (!document) {
      // Hard-deleted (or never existed) by the time we got here — nothing to notify about.
      await db.update(documentExpirations, row.id, { notifiedAt: now, resolvedAt: now })
      continue
    }

    const daysRemaining = Math.ceil((row.expirationDate.getTime() - now.getTime()) / 86_400_000)
    const resource = await resourceForDocument(db, document)

    await emitNotification({
      tenantId,
      eventKey: row.kind === 'expired' ? 'document.expired' : 'document.expiring',
      subject: { type: 'document', id: document.id },
      tokens: {
        documentType: document.documentType,
        expirationDate: row.expirationDate.toISOString(),
        daysRemaining,
      },
      audience: resource,
      // Distinguishes this expiration cycle from a later one on the same
      // document (renewed, then expires again years later) — without it a
      // second cycle would collide with the first row's dedupe key and
      // never notify.
      dedupeSuffix: row.expirationDate.toISOString(),
    })

    if (row.kind === 'expired') expired += 1
    else expiring += 1

    await db.update(documentExpirations, row.id, { notifiedAt: now })
  }

  return { expiring, expired }
}

async function runSweep(_payload: z.infer<typeof sweepSchema>, _ctx: JobContext): Promise<void> {
  const now = new Date()
  const tenantIds = await listSweepableTenantIds()

  for (const tenantId of tenantIds) {
    const db = tenantDb(tenantId)
    const warningDays = await warningDaysFor(db)

    await resolveStaleExpirations(db, now)
    await markExpirations(db, warningDays)
    await notifyPendingExpirations(db, tenantId, now)
  }
}

/** Re-exported for the integration suite, which asserts on `listExpiring`'s own contract too. */
export { listExpiring, markExpirations, resolveStaleExpirations, notifyPendingExpirations, runSweep }

defineJob('document.expiration_sweep', {
  schema: sweepSchema,
  handler: runSweep,
  defaultMaxAttempts: 3,
  description:
    'Daily sweep: materializes document_expirations rows inside the warning window, resolves stale ones, and notifies once per document per kind.',
})
