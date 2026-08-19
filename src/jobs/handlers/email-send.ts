import 'server-only'
import { z } from 'zod'
import { getEmailProvider } from '@/integrations/email'
import { defineJob, type JobContext } from '../registry'

/**
 * A generic queued outbound email — for callers that need to send mail
 * without going through the `notifications` domain (which has its own
 * queued channel, drained by `notification-delivery.ts`). Not currently
 * enqueued by any producer in this codebase; registered so any future
 * caller has a durable, retried, dead-lettered channel to reach for instead
 * of an inline `await getEmailProvider().send(...)` with no retry.
 *
 * Idempotent via `idempotencyKey`, which is required and forwarded straight
 * to the provider: the mock and Mailgun adapters both dedupe a resend with
 * the same key (see `integrations/email/*-adapter.ts`), so a retried attempt
 * after a successful-but-unacknowledged send never double-delivers.
 */

const payloadSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
  idempotencyKey: z.string().min(1),
  tags: z.array(z.string()).optional(),
})

export async function sendQueuedEmail(payload: z.infer<typeof payloadSchema>, _ctx: JobContext): Promise<void> {
  await getEmailProvider().send({
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    idempotencyKey: payload.idempotencyKey,
    tags: payload.tags,
  })
}

defineJob('email.send', {
  schema: payloadSchema,
  handler: sendQueuedEmail,
  defaultMaxAttempts: 6,
  description: 'Generic queued outbound email, retried and dead-lettered on repeated provider failure.',
})
