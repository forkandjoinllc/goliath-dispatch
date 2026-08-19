/**
 * Live adapter for Stripe, via the official `stripe` package (installed).
 * Selected only when `STRIPE_DRIVER=live`. Every mutating call carries an
 * idempotency key — caller-supplied when given, otherwise generated per call
 * so a retried request from this process is still safe, though callers that
 * may themselves retry (jobs, server actions) should pass their own key.
 */
import Stripe from 'stripe'
import { serverEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import { newId } from '@/lib/crypto'
import { mapProviderError, notConfiguredError } from '../_shared/errors'
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

const PROVIDER_NAME = 'payments.stripe'

function idempotencyKey(provided: string | undefined, scope: string): string {
  return provided ?? `${scope}-${newId()}`
}

function toSubscriptionRecord(sub: Stripe.Subscription): SubscriptionRecord {
  const priceId = sub.items.data[0]?.price?.id ?? ''
  return {
    subscriptionId: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    priceId,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  }
}

function normalizeRefundStatus(status: string | null): RefundRecord['status'] {
  return status === 'pending' || status === 'succeeded' || status === 'failed' || status === 'canceled'
    ? status
    : 'pending'
}

function toWebhookEventData(object: unknown): Record<string, unknown> {
  return object as Record<string, unknown>
}

function toPaymentIntentRecord(pi: Stripe.PaymentIntent): PaymentIntentRecord {
  return {
    paymentIntentId: pi.id,
    clientSecret: pi.client_secret,
    status: pi.status,
    amountCents: pi.amount,
  }
}

export class StripePaymentAdapter implements PaymentProvider {
  readonly name = PROVIDER_NAME

  private readonly client: Stripe
  private readonly webhookSecret: string

  constructor() {
    const env = serverEnv()
    if (!env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY === 'sk_test_placeholder') {
      throw notConfiguredError(PROVIDER_NAME, 'integrations.payments.notConfigured')
    }
    this.client = new Stripe(env.STRIPE_SECRET_KEY)
    this.webhookSecret = env.STRIPE_WEBHOOK_SECRET
  }

  async createCustomer(input: CreateCustomerInput): Promise<CustomerRecord> {
    try {
      const customer = await this.client.customers.create(
        { email: input.email, name: input.name, metadata: { tenantId: input.tenantId, ...input.metadata } },
        { idempotencyKey: idempotencyKey(undefined, `customer-${input.tenantId}`) },
      )
      return { customerId: customer.id, email: input.email, name: input.name }
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.payments.unavailable')
    }
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    try {
      const sub = await this.client.subscriptions.create(
        {
          customer: input.customerId,
          items: [{ price: input.priceId }],
          trial_period_days: input.trialDays,
          metadata: input.metadata,
        },
        { idempotencyKey: idempotencyKey(input.idempotencyKey, `sub-create-${input.customerId}`) },
      )
      return toSubscriptionRecord(sub)
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.payments.unavailable')
    }
  }

  async updateSubscription(input: UpdateSubscriptionInput): Promise<SubscriptionRecord> {
    try {
      const current = await this.client.subscriptions.retrieve(input.subscriptionId)
      const sub = await this.client.subscriptions.update(
        input.subscriptionId,
        {
          items: input.priceId ? [{ id: current.items.data[0]?.id, price: input.priceId }] : undefined,
          cancel_at_period_end: input.cancelAtPeriodEnd,
          metadata: input.metadata,
        },
        { idempotencyKey: idempotencyKey(input.idempotencyKey, `sub-update-${input.subscriptionId}`) },
      )
      return toSubscriptionRecord(sub)
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.payments.unavailable')
    }
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<SubscriptionRecord> {
    try {
      const sub = input.atPeriodEnd
        ? await this.client.subscriptions.update(
            input.subscriptionId,
            { cancel_at_period_end: true },
            { idempotencyKey: idempotencyKey(input.idempotencyKey, `sub-cancel-${input.subscriptionId}`) },
          )
        : await this.client.subscriptions.cancel(input.subscriptionId, undefined, {
            idempotencyKey: idempotencyKey(input.idempotencyKey, `sub-cancel-${input.subscriptionId}`),
          })
      return toSubscriptionRecord(sub)
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.payments.unavailable')
    }
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionRecord> {
    try {
      const session = await this.client.checkout.sessions.create(
        {
          mode: 'subscription',
          customer: input.customerId,
          customer_email: input.customerId ? undefined : input.customerEmail,
          line_items: [{ price: input.priceId, quantity: 1 }],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          metadata: input.metadata,
        },
        { idempotencyKey: idempotencyKey(input.idempotencyKey, 'checkout') },
      )
      if (!session.url) {
        throw new Error('Stripe Checkout Session created without a redirect URL')
      }
      return { sessionId: session.id, url: session.url }
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.payments.unavailable')
    }
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentRecord> {
    try {
      const pi = await this.client.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: input.currency ?? 'usd',
          customer: input.customerId,
          description: input.description,
          payment_method_types: input.paymentMethodTypes ?? ['card', 'us_bank_account'],
          metadata: input.metadata,
        },
        { idempotencyKey: idempotencyKey(input.idempotencyKey, 'pi') },
      )
      return toPaymentIntentRecord(pi)
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.payments.unavailable')
    }
  }

  async createRefund(input: CreateRefundInput): Promise<RefundRecord> {
    try {
      const refund = await this.client.refunds.create(
        {
          payment_intent: input.paymentIntentId,
          amount: input.amountCents,
          reason: input.reason,
        },
        { idempotencyKey: idempotencyKey(input.idempotencyKey, `refund-${input.paymentIntentId}`) },
      )
      return {
        refundId: refund.id,
        paymentIntentId: input.paymentIntentId,
        amountCents: refund.amount,
        status: normalizeRefundStatus(refund.status),
      }
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.payments.unavailable')
    }
  }

  async retrieveEvent(eventId: string): Promise<WebhookEvent> {
    try {
      const event = await this.client.events.retrieve(eventId)
      return {
        id: event.id,
        type: event.type,
        createdAt: new Date(event.created * 1000),
        data: toWebhookEventData(event.data.object),
        livemode: event.livemode,
      }
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.payments.unavailable')
    }
  }

  constructWebhookEvent(rawBody: string | Buffer, signature: string): WebhookEvent {
    try {
      const event = this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret)
      return {
        id: event.id,
        type: event.type,
        createdAt: new Date(event.created * 1000),
        data: toWebhookEventData(event.data.object),
        livemode: event.livemode,
      }
    } catch (error) {
      logger.warn('stripe webhook signature verification failed', { provider: PROVIDER_NAME })
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.payments.invalidSignature')
    }
  }
}
