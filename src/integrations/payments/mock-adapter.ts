import { hmacHex, newId, safeEqual } from '@/lib/crypto'
import { AppError } from '@/lib/errors'
import { serverEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import type {
  CancelSubscriptionInput,
  CheckoutSessionRecord,
  CreateCheckoutSessionInput,
  CreateCustomerInput,
  CreatePaymentIntentInput,
  CreateRefundInput,
  CreateSubscriptionInput,
  CustomerRecord,
  PaymentIntentRecord,
  PaymentProvider,
  RefundRecord,
  SubscriptionRecord,
  UpdateSubscriptionInput,
  WebhookEvent,
} from './provider'

const PROVIDER_NAME = 'payments.mock'

/**
 * An in-memory Stripe. IDs are prefixed and ordered (`cus_mock_1_<rand>`, …
 * incrementing per type) so a test can assert on them directly instead of
 * capturing whatever was generated. `emitMockEvent` + `constructWebhookEvent`
 * round-trip through the SAME HMAC scheme production would verify against a
 * real Stripe signature — only the algorithm inputs (JSON body + our own
 * secret) differ from Stripe's, not the shape of the check.
 */

interface MockState {
  customers: Map<string, CustomerRecord>
  subscriptions: Map<string, SubscriptionRecord>
  paymentIntents: Map<string, PaymentIntentRecord>
  refunds: Map<string, RefundRecord>
  events: Map<string, WebhookEvent>
  counters: Record<string, number>
}

function freshState(): MockState {
  return {
    customers: new Map(),
    subscriptions: new Map(),
    paymentIntents: new Map(),
    refunds: new Map(),
    events: new Map(),
    counters: {},
  }
}

let state = freshState()

/** Test-only: wipes every in-memory record and resets id counters. */
export function resetMockPayments(): void {
  state = freshState()
}

/**
 * IDs incorporate a random suffix (`newId()`, the same primitive
 * `email`/`sms`'s mock adapters use for message ids) rather than being a
 * bare incrementing counter. A pure per-process counter restarting at 1
 * collides the instant two processes both mint a mock id into the same
 * database — exactly what happens here: `src/db/seed/*.ts` runs as its own
 * short-lived process and seeds a subscription with `stripeSubscriptionId
 * = 'sub_mock_1'`, then the very first real signup against the long-running
 * app server also starts counting from 1 and tries to insert that same id
 * into `tenant_subscriptions.stripe_subscription_id` (unique), failing
 * every time. The counter is kept only for human-scannable ordering in logs.
 */
function nextId(prefix: string): string {
  state.counters[prefix] = (state.counters[prefix] ?? 0) + 1
  return `${prefix}_mock_${state.counters[prefix]}_${newId().slice(0, 8)}`
}

function computeSignature(rawBody: string, timestamp: number, secret: string): string {
  return hmacHex(`${timestamp}.${rawBody}`, secret)
}

/**
 * Builds a synthetic Stripe-style event and signs it exactly the way
 * `constructWebhookEvent` verifies — a test POSTs `rawBody` with a
 * `Stripe-Signature: <signature>`-shaped header to the webhook route and
 * gets the real verification path, not a bypass.
 */
export function emitMockEvent(
  type: string,
  object: Record<string, unknown>,
): { rawBody: string; signature: string; eventId: string } {
  const eventId = nextId('evt')
  const createdAt = new Date()
  const payload = {
    id: eventId,
    type,
    created: Math.floor(createdAt.getTime() / 1000),
    livemode: false,
    data: { object },
  }
  const rawBody = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = `t=${timestamp},v1=${computeSignature(rawBody, timestamp, serverEnv().STRIPE_WEBHOOK_SECRET)}`

  state.events.set(eventId, {
    id: eventId,
    type,
    createdAt,
    data: object,
    livemode: false,
  })

  return { rawBody, signature, eventId }
}

export class MockPaymentAdapter implements PaymentProvider {
  readonly name = PROVIDER_NAME

  async createCustomer(input: CreateCustomerInput): Promise<CustomerRecord> {
    const record: CustomerRecord = { customerId: nextId('cus'), email: input.email, name: input.name }
    state.customers.set(record.customerId, record)
    logger.debug('payments mock: customer created', { provider: PROVIDER_NAME, customerId: record.customerId })
    return record
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    const periodEnd = new Date()
    periodEnd.setDate(periodEnd.getDate() + 30)
    const record: SubscriptionRecord = {
      subscriptionId: nextId('sub'),
      customerId: input.customerId,
      priceId: input.priceId,
      status: input.trialDays && input.trialDays > 0 ? 'trialing' : 'active',
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    }
    state.subscriptions.set(record.subscriptionId, record)
    return record
  }

  async updateSubscription(input: UpdateSubscriptionInput): Promise<SubscriptionRecord> {
    const existing = state.subscriptions.get(input.subscriptionId)
    if (!existing) {
      throw new AppError('not_found', 'integrations.payments.subscriptionNotFound', {
        params: { subscriptionId: input.subscriptionId },
      })
    }
    const updated: SubscriptionRecord = {
      ...existing,
      priceId: input.priceId ?? existing.priceId,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? existing.cancelAtPeriodEnd,
    }
    state.subscriptions.set(updated.subscriptionId, updated)
    return updated
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<SubscriptionRecord> {
    const existing = state.subscriptions.get(input.subscriptionId)
    if (!existing) {
      throw new AppError('not_found', 'integrations.payments.subscriptionNotFound', {
        params: { subscriptionId: input.subscriptionId },
      })
    }
    const updated: SubscriptionRecord = input.atPeriodEnd
      ? { ...existing, cancelAtPeriodEnd: true }
      : { ...existing, status: 'canceled', cancelAtPeriodEnd: false }
    state.subscriptions.set(updated.subscriptionId, updated)
    return updated
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionRecord> {
    const sessionId = nextId('cs')
    return { sessionId, url: `https://mock-checkout.local/session/${sessionId}?price=${input.priceId}` }
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentRecord> {
    const paymentIntentId = nextId('pi')
    const record: PaymentIntentRecord = {
      paymentIntentId,
      clientSecret: `${paymentIntentId}_secret_mock`,
      status: 'requires_payment_method',
      amountCents: input.amountCents,
    }
    state.paymentIntents.set(paymentIntentId, record)
    return record
  }

  async createRefund(input: CreateRefundInput): Promise<RefundRecord> {
    const paymentIntent = state.paymentIntents.get(input.paymentIntentId)
    if (!paymentIntent) {
      throw new AppError('not_found', 'integrations.payments.paymentIntentNotFound', {
        params: { paymentIntentId: input.paymentIntentId },
      })
    }
    const record: RefundRecord = {
      refundId: nextId('re'),
      paymentIntentId: input.paymentIntentId,
      amountCents: input.amountCents ?? paymentIntent.amountCents,
      status: 'succeeded',
    }
    state.refunds.set(record.refundId, record)
    return record
  }

  async retrieveEvent(eventId: string): Promise<WebhookEvent> {
    const event = state.events.get(eventId)
    if (!event) {
      throw new AppError('not_found', 'integrations.payments.eventNotFound', { params: { eventId } })
    }
    return event
  }

  constructWebhookEvent(rawBody: string | Buffer, signature: string): WebhookEvent {
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
    const parts = Object.fromEntries(
      signature.split(',').map((kv) => {
        const [key, value] = kv.split('=')
        return [key, value] as [string, string]
      }),
    )
    const timestamp = parts.t
    const providedSignature = parts.v1
    if (!timestamp || !providedSignature) {
      throw new AppError('validation_failed', 'integrations.payments.invalidSignature')
    }

    const expected = computeSignature(body, Number(timestamp), serverEnv().STRIPE_WEBHOOK_SECRET)
    if (!safeEqual(expected, providedSignature)) {
      throw new AppError('validation_failed', 'integrations.payments.invalidSignature')
    }

    let parsed: { id: string; type: string; created: number; livemode?: boolean; data: { object: unknown } }
    try {
      parsed = JSON.parse(body)
    } catch (error) {
      throw new AppError('validation_failed', 'integrations.payments.invalidPayload', { cause: error })
    }

    return {
      id: parsed.id,
      type: parsed.type,
      createdAt: new Date(parsed.created * 1000),
      data: (parsed.data?.object ?? {}) as Record<string, unknown>,
      livemode: parsed.livemode ?? false,
    }
  }
}
