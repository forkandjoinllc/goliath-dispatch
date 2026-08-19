import 'server-only'
import { z } from 'zod'
import { tenantDb } from '@/db/tenant-db'
import { getSmsProvider, toE164Us } from '@/integrations/sms'
import { hasActiveSmsConsent, loadSmsConsentRecords } from '@/server/notifications/delivery'
import { AppError } from '@/lib/errors'
import { defineJob, type JobContext } from '../registry'

/**
 * A generic queued outbound SMS — the same "available for a future caller"
 * role `email-send.ts` plays; `notification.deliver` remains the channel for
 * anything routed through the `notifications` domain.
 *
 * Consent is re-verified here, from the same `consentRecords` table
 * `deliverSms()` reads, from the *user id* the payload names — never taken
 * on faith from the caller. A payload cannot "assert" consent; only a real,
 * un-revoked `consentRecords` row for that user can. Sending without it is a
 * dead-letter, not a retry — retrying can't manufacture a consent record.
 */

const payloadSchema = z.object({
  userId: z.string().uuid(),
  to: z.string().min(1),
  body: z.string().min(1),
  idempotencyKey: z.string().min(1),
})

export async function sendQueuedSms(payload: z.infer<typeof payloadSchema>, ctx: JobContext): Promise<void> {
  if (!ctx.tenantId) throw new Error('sms.send requires a tenantId')
  const db = tenantDb(ctx.tenantId)

  const consentGranted = hasActiveSmsConsent(await loadSmsConsentRecords(db, payload.userId))
  if (!consentGranted) {
    // A missing consent record will still be missing on the next attempt,
    // so this isn't truly retryable — but the queue has no "fail
    // permanently right now" signal short of `maxAttempts`, and this
    // handler has no reason to reach past `queue.ts`'s public API to force
    // one. It dead-letters after the normal (short) retry budget instead.
    throw new AppError('validation_failed', 'errors.smsConsentMissing')
  }

  const e164 = toE164Us(payload.to)
  if (!e164) {
    throw new AppError('validation_failed', 'errors.invalidPhoneNumber')
  }

  await getSmsProvider().send({
    to: e164,
    body: payload.body,
    consentGranted: true,
    idempotencyKey: payload.idempotencyKey,
  })
}

defineJob('sms.send', {
  schema: payloadSchema,
  handler: sendQueuedSms,
  defaultMaxAttempts: 3,
  description: 'Generic queued outbound SMS; dead-letters quickly (short retry budget) without recorded, un-revoked consent.',
})
