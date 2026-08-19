import 'server-only'
import { z } from 'zod'
import { tenantDb } from '@/db/tenant-db'
import { notifications } from '@/db/schema'
import { deliverNotification } from '@/server/notifications/delivery'
import { defineJob, type JobContext } from '../registry'

/**
 * Drains one queued email/SMS notification.
 *
 * `deliverNotification()` is the idempotent, tenant-scoped unit of work, but
 * it is a no-op for any row that is not currently `status: 'queued'` — so on
 * a transient failure this handler resets the row back to `queued` before
 * throwing, which is what makes the *next* attempt (the queue's own
 * backoff/retry) actually re-attempt the send rather than silently
 * re-observing the same `failed` row forever. Only on the final attempt
 * (`ctx.attempt >= ctx.maxAttempts`, about to dead-letter) is the row left
 * in its terminal `failed` state, so a dead-lettered notification reads as
 * failed, not as perpetually pending.
 *
 * SMS consent is enforced entirely inside `deliverNotification()` /
 * `deliverSms()` — this handler never sees, and never needs to see, whether
 * consent was granted; it cannot accidentally bypass it.
 */

const payloadSchema = z.object({ notificationId: z.string().uuid() })

export async function deliverQueuedNotification(payload: z.infer<typeof payloadSchema>, ctx: JobContext): Promise<void> {
  if (!ctx.tenantId) throw new Error('notification.deliver requires a tenantId')
  const db = tenantDb(ctx.tenantId)
  const notification = await deliverNotification(db, payload.notificationId)

  if (notification.status === 'failed') {
    const isFinalAttempt = ctx.attempt >= ctx.maxAttempts
    if (!isFinalAttempt) {
      await db.update(notifications, notification.id, { status: 'queued' })
    }
    throw new Error(`notification ${notification.id} failed to deliver: ${notification.failureReason ?? 'unknown'}`)
  }
}

defineJob('notification.deliver', {
  schema: payloadSchema,
  handler: deliverQueuedNotification,
  defaultMaxAttempts: 6,
  description: 'Drains one queued email/SMS notification through the registered provider, with retry.',
})
