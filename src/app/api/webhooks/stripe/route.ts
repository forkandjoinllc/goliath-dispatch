import 'server-only'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'
import { unsafeDb } from '@/db/client'
import { stripeEvents } from '@/db/schema'
import { effectForStripeEvent, getPaymentProvider, type WebhookEvent } from '@/integrations/payments'
import { sha256Hex } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import { recordAudit, type AuditRequestContext } from '@/lib/audit'
import { handleSubscriptionEvent, handleSubscriptionInvoiceEvent } from '@/server/tenants/subscription'
/**
 * Imported for its module-level side effect: loading the invoice service calls
 * `registerInvoicePaymentEffects()`, which must have happened before the first
 * carrier-payment webhook is processed.
 *
 * This registration used to live in `instrumentation.ts`, but Next compiles that
 * file for the Edge runtime as well as Node, and webpack resolves a dynamic
 * `import()` statically — so warming a module that reaches `postgres` broke the
 * Edge bundle. Doing it here is both simpler and stricter: the one route that
 * depends on the registration is the route that guarantees it, on every cold
 * start, with no ordering assumption.
 */
import '@/server/invoices/service'
import {
  extractInvoiceMetadata,
  getInvoicePaymentEffects,
  type CarrierInvoicePaymentEvent,
} from '@/server/tenants/payment-effects'

/**
 * Stripe webhook intake.
 *
 * Every request is verified against the raw body before anything else
 * happens — an invalid signature is rejected with 400 and never reaches the
 * database. A valid event is then recorded exactly once, keyed by Stripe's
 * own event id: a duplicate delivery (Stripe retries on anything but a 2xx)
 * short-circuits to 200 without re-applying any effect. A processing
 * failure leaves the row `failed` with an incremented attempt count and
 * returns 500 so Stripe retries with backoff.
 */

export const runtime = 'nodejs'

function requestMetaFrom(request: NextRequest): AuditRequestContext {
  const forwarded = request.headers.get('x-forwarded-for')
  return {
    ipAddress: forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? null,
    userAgent: request.headers.get('user-agent'),
    requestId: request.headers.get('x-request-id') ?? randomUUID(),
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 })
  }

  let event: WebhookEvent
  try {
    event = getPaymentProvider().constructWebhookEvent(rawBody, signature)
  } catch (error) {
    logger.warn('stripe webhook: signature verification failed', { error })
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })
  }

  const requestMeta = requestMetaFrom(request)

  // Idempotency: the unique index on `stripe_event_id` makes this insert the
  // single source of truth for "have we seen this event before". A conflict
  // means a duplicate delivery — nothing downstream runs a second time.
  const inserted = await unsafeDb
    .insert(stripeEvents)
    .values({
      stripeEventId: event.id,
      eventType: event.type,
      payloadDigest: sha256Hex(rawBody),
      payload: event.data,
      processingStatus: 'received',
    })
    .onConflictDoNothing({ target: stripeEvents.stripeEventId })
    .returning({ id: stripeEvents.id })

  const row = inserted[0]
  if (!row) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    const result = await processEvent(event, requestMeta)

    if (result.status === 'processed' || result.status === 'ignored') {
      await unsafeDb
        .update(stripeEvents)
        .set({
          processingStatus: result.status,
          processedAt: new Date(),
          tenantId: result.tenantId,
        })
        .where(eq(stripeEvents.id, row.id))
    } else {
      // 'deferred': the row stays `received` on purpose, so a background
      // replay job can find and re-run it once the missing dependency
      // (usually the finance module's registered payment effects) is
      // available. This is a successful receipt, not a failure — Stripe
      // does not need to retry delivery.
      await unsafeDb
        .update(stripeEvents)
        .set({ tenantId: result.tenantId })
        .where(eq(stripeEvents.id, row.id))
    }

    return NextResponse.json({ received: true, status: result.status })
  } catch (error) {
    logger.error('stripe webhook: processing failed', { eventId: event.id, eventType: event.type, error })
    await unsafeDb
      .update(stripeEvents)
      .set({
        processingStatus: 'failed',
        attempts: sql`${stripeEvents.attempts} + 1`,
        errorMessage: error instanceof Error ? error.message : 'unknown error',
      })
      .where(eq(stripeEvents.id, row.id))
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}

interface ProcessResult {
  status: 'processed' | 'ignored' | 'deferred'
  tenantId: string | null
}

async function processEvent(event: WebhookEvent, requestMeta: AuditRequestContext): Promise<ProcessResult> {
  const effect = effectForStripeEvent(event.type)
  if (!effect) return { status: 'ignored', tenantId: null }

  switch (effect) {
    case 'subscription.sync':
    case 'subscription.mark_cancelled': {
      const result = await handleSubscriptionEvent(event, requestMeta)
      return { status: result.handled ? 'processed' : 'ignored', tenantId: result.tenantId }
    }
    case 'invoice.mark_paid':
    case 'invoice.mark_payment_failed': {
      const result = await handleSubscriptionInvoiceEvent(event, requestMeta)
      return { status: result.handled ? 'processed' : 'ignored', tenantId: result.tenantId }
    }
    case 'payment.mark_succeeded':
    case 'payment.mark_failed':
    case 'payment.mark_refunded':
    case 'payment.flag_disputed':
      return handlePaymentDomainEvent(effect, event, requestMeta)
  }
}

/**
 * Routes PaymentIntent/Charge events into the finance module's registered
 * `InvoicePaymentEffects` implementation. See `payment-effects.ts` for the
 * full contract. Anything that cannot be routed (missing metadata, or no
 * implementation registered yet) is deferred rather than dropped.
 */
async function handlePaymentDomainEvent(
  effect: 'payment.mark_succeeded' | 'payment.mark_failed' | 'payment.mark_refunded' | 'payment.flag_disputed',
  event: WebhookEvent,
  requestMeta: AuditRequestContext,
): Promise<ProcessResult> {
  const object = event.data
  const meta = extractInvoiceMetadata(object)
  if (!meta) {
    logger.warn('stripe webhook: payment event missing tenantId/invoiceId metadata, deferring for replay', {
      eventType: event.type,
    })
    return { status: 'deferred', tenantId: null }
  }

  const effects = getInvoicePaymentEffects()
  if (!effects) {
    logger.warn('stripe webhook: no invoice payment effects registered, deferring for replay', {
      eventType: event.type,
      tenantId: meta.tenantId,
    })
    return { status: 'deferred', tenantId: meta.tenantId }
  }

  const isPaymentIntentEvent = event.type.startsWith('payment_intent')
  const base: CarrierInvoicePaymentEvent = {
    tenantId: meta.tenantId,
    invoiceId: meta.invoiceId,
    kind: meta.kind,
    stripeEventId: event.id,
    stripeEventType: event.type,
    paymentIntentId: isPaymentIntentEvent
      ? readString(object.id)
      : readString(object.payment_intent),
    chargeId: !isPaymentIntentEvent ? readString(object.id) : null,
    amountCents: typeof object.amount === 'number' ? object.amount : 0,
    currency: typeof object.currency === 'string' ? object.currency : 'usd',
    occurredAt: event.createdAt,
    raw: object,
  }

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

  return { status: 'processed', tenantId: meta.tenantId }
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
