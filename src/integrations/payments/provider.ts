export interface CreateCustomerInput {
  tenantId: string
  email: string
  name: string
  metadata?: Record<string, string>
}

export interface CustomerRecord {
  customerId: string
  email: string
  name: string
}

export interface CreateSubscriptionInput {
  customerId: string
  priceId: string
  trialDays?: number
  metadata?: Record<string, string>
  idempotencyKey?: string
}

export interface UpdateSubscriptionInput {
  subscriptionId: string
  priceId?: string
  cancelAtPeriodEnd?: boolean
  metadata?: Record<string, string>
  idempotencyKey?: string
}

export interface CancelSubscriptionInput {
  subscriptionId: string
  /** Cancel at the end of the current billing period rather than immediately. */
  atPeriodEnd?: boolean
  idempotencyKey?: string
}

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused'

export interface SubscriptionRecord {
  subscriptionId: string
  customerId: string
  priceId: string
  status: SubscriptionStatus
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export interface CreateCheckoutSessionInput {
  customerId?: string
  customerEmail?: string
  priceId: string
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, string>
  idempotencyKey?: string
}

export interface CheckoutSessionRecord {
  sessionId: string
  url: string
}

export interface CreatePaymentIntentInput {
  amountCents: number
  currency?: string
  customerId?: string
  description?: string
  /** Defaults to `['card', 'us_bank_account']` — card and ACH both available unless narrowed. */
  paymentMethodTypes?: Array<'card' | 'us_bank_account'>
  metadata?: Record<string, string>
  idempotencyKey?: string
}

export type PaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'canceled'
  | 'succeeded'

export interface PaymentIntentRecord {
  paymentIntentId: string
  clientSecret: string | null
  status: PaymentIntentStatus
  amountCents: number
}

export interface CreateRefundInput {
  paymentIntentId: string
  /** Omit for a full refund. */
  amountCents?: number
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'
  idempotencyKey?: string
}

export interface RefundRecord {
  refundId: string
  paymentIntentId: string
  amountCents: number
  status: 'pending' | 'succeeded' | 'failed' | 'canceled'
}

export interface WebhookEvent {
  id: string
  type: string
  createdAt: Date
  /** The event's `data.object`, normalized to a plain record. */
  data: Record<string, unknown>
  livemode: boolean
}

export interface PaymentProvider {
  readonly name: string
  createCustomer(input: CreateCustomerInput): Promise<CustomerRecord>
  createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionRecord>
  updateSubscription(input: UpdateSubscriptionInput): Promise<SubscriptionRecord>
  cancelSubscription(input: CancelSubscriptionInput): Promise<SubscriptionRecord>
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionRecord>
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentRecord>
  createRefund(input: CreateRefundInput): Promise<RefundRecord>
  retrieveEvent(eventId: string): Promise<WebhookEvent>
  /** `rawBody` MUST be the exact bytes/string Stripe (or the mock) sent — never a re-serialized JSON object. */
  constructWebhookEvent(rawBody: string | Buffer, signature: string): WebhookEvent
}
