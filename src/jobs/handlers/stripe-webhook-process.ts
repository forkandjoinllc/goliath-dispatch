import 'server-only'
import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { stripeEvents, type StripeEvent } from '@/db/schema'
import { effectForStripeEvent } from '@/integrations/payments'
import { extractInvoiceMetadata, getInvoicePaymentEffects, type CarrierInvoicePaymentEvent } from '@/server/tenants/payment-effects'
import { recordAudit } from '@/lib/audit'
import { newId } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import { defineJob, type JobContext } from '../registry'

/**
 * Replays payment-domain Stripe events left `received` (never routed —
 * usually because no `InvoicePaymentEffects` implementation had registered
 * yet at delivery time) or `failed` (the webhook route's handler threw).
 *
 * Deliberately scoped to the payment-domain effects the finance module
 * registers (`payment.mark_succeeded` / `_failed` / `_refunded` /
 * `flag_disputed` — see `src/integrations/payments/events.ts` and
 * `src/app/api/webhooks/stripe/route.ts::handlePaymentDomainEvent`, whose
 * routing this mirrors exactly). Subscription-domain events
 * (`subscription.sync`, `invoice.mark_paid`, …) are the tenants module's own
 * territory and are never deferred by the webhook route in the first place —
 * a `received`/`failed` row of that family reflects a bug in that module,
 * not a missing registration, and replaying it here would be reaching into
 * a module this agent does not own. It is left `received`/`failed` for that
 * module's own operator tooling.
 *
 * Idempotent on `stripeEventId`: `recordPaymentSucceeded` etc. are each
 * independently idempotent (see `invoices/service.ts`'s header comment on
 * `invoicePaymentEffects`), and this handler only ever transitions a given
 * row's `processingStatus` forward, never re-processes a row already marked
 * `processed`/`ignored`.
 */

const sweepSchema = z.object({}).strict()

type PaymentDomainEffect = 'payment.mark_succeeded' | 'payment.mark_failed' | 'payment.mark_refunded' | 'payment.flag_disputed'

function isPaymentDomainEffect(effect: string | null): effect is PaymentDomainEffect {
  return (
    effect === 'payment.mark_succeeded' ||
    effect === 'payment.mark_failed' ||
    effect === 'payment.mark_refunded' ||
    effect === 'payment.flag_disputed'
  )
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readFailureReason(object: Record<string, unknown>): string | null {
  const error = object.last_payment_error
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return null
}

async function replayRow(row: StripeEvent): Promise<'processed' | 'skipped'> {
  const effect = effectForStripeEvent(row.eventType)
  if (!isPaymentDomainEffect(effect)) {
    return 'skipped'
  }

  const object = (row.payload ?? {}) as Record<string, unknown>
  const meta = extractInvoiceMetadata(object)
  if (!meta) {
    logger.warn('stripe replay: payment event still missing tenantId/invoiceId metadata', { eventType: row.eventType })
    return 'skipped'
  }

  const effects = getInvoicePaymentEffects()
  if (!effects) {
    logger.warn('stripe replay: no invoice payment effects registered yet', { eventType: row.eventType })
    return 'skipped'
  }

  const isPaymentIntentEvent = row.eventType.startsWith('payment_intent')
  const base: CarrierInvoicePaymentEvent = {
    tenantId: meta.tenantId,
    invoiceId: meta.invoiceId,
    kind: meta.kind,
    stripeEventId: row.stripeEventId,
    stripeEventType: row.eventType,
    paymentIntentId: isPaymentIntentEvent ? readString(object.id) : readString(object.payment_intent),
    chargeId: !isPaymentIntentEvent ? readString(object.id) : null,
    amountCents: typeof object.amount === 'number' ? object.amount : 0,
    currency: typeof object.currency === 'string' ? object.currency : 'usd',
    // The original Stripe event timestamp is not persisted separately from
    // the row itself; the row's own `createdAt` (set at webhook receipt) is
    // the closest available approximation and is only ever off by the
    // request's own processing latency.
    occurredAt: row.createdAt,
    raw: object,
  }

  const requestMeta = { ipAddress: null, userAgent: null, requestId: newId() }

  switch (effect) {
    case 'payment.mark_succeeded':
      await effects.recordPaymentSucceeded(base)
      await recordAudit(null, requestMeta, {
        action: 'payment.recorded',
        entityType: 'invoice',
        entityId: meta.invoiceId,
        tenantId: meta.tenantId,
      })
      break
    case 'payment.mark_failed':
      await effects.recordPaymentFailed({ ...base, failureReason: readFailureReason(object) })
      await recordAudit(null, requestMeta, {
        action: 'payment.failed',
        entityType: 'invoice',
        entityId: meta.invoiceId,
        tenantId: meta.tenantId,
      })
      break
    case 'payment.mark_refunded':
      await effects.recordRefund({ ...base, refundId: readString(object.id) })
      await recordAudit(null, requestMeta, {
        action: 'payment.refunded',
        entityType: 'invoice',
        entityId: meta.invoiceId,
        tenantId: meta.tenantId,
      })
      break
    case 'payment.flag_disputed':
      await effects.recordDispute({ ...base, disputeId: readString(object.id) })
      await recordAudit(null, requestMeta, {
        action: 'invoice.status_changed',
        entityType: 'invoice',
        entityId: meta.invoiceId,
        tenantId: meta.tenantId,
        reason: 'stripe_dispute_created',
      })
      break
  }

  return 'processed'
}

async function runReplaySweep(_payload: z.infer<typeof sweepSchema>, _ctx: JobContext): Promise<void> {
  const rows = await unsafeDb.select().from(stripeEvents).where(inArray(stripeEvents.processingStatus, ['received', 'failed']))

  for (const row of rows) {
    try {
      const outcome = await replayRow(row)
      if (outcome === 'processed') {
        await unsafeDb
          .update(stripeEvents)
          .set({ processingStatus: 'processed', processedAt: new Date(), errorMessage: null })
          .where(eq(stripeEvents.id, row.id))
      }
      // 'skipped' rows are left exactly as they were — still eligible for a
      // later replay once the finance module is registered.
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      logger.error('stripe replay: effect threw', { stripeEventId: row.stripeEventId, eventType: row.eventType, error })
      await unsafeDb
        .update(stripeEvents)
        .set({ processingStatus: 'failed', errorMessage: message, attempts: row.attempts + 1 })
        .where(eq(stripeEvents.id, row.id))
    }
  }
}

defineJob('stripe.webhook_replay_sweep', {
  schema: sweepSchema,
  handler: runReplaySweep,
  defaultMaxAttempts: 3,
  description: 'Replays payment-domain Stripe events left received/failed once payment effects are registered.',
})
