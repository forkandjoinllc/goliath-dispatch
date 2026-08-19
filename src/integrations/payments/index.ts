import { serverEnv } from '@/lib/env'
import type { PaymentProvider } from './provider'
import { MockPaymentAdapter } from './mock-adapter'
import { StripePaymentAdapter } from './stripe-adapter'

let cached: PaymentProvider | null = null

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached
  const driver = serverEnv().STRIPE_DRIVER
  cached = driver === 'live' ? new StripePaymentAdapter() : new MockPaymentAdapter()
  return cached
}

/** Test-only: clears the memoized provider so a test can flip the driver env var. */
export function resetPaymentProviderCache(): void {
  cached = null
}

export type {
  PaymentProvider,
  CustomerRecord,
  SubscriptionRecord,
  SubscriptionStatus,
  CheckoutSessionRecord,
  PaymentIntentRecord,
  PaymentIntentStatus,
  RefundRecord,
  WebhookEvent,
  CreateCustomerInput,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  CancelSubscriptionInput,
  CreateCheckoutSessionInput,
  CreatePaymentIntentInput,
  CreateRefundInput,
} from './provider'
export { emitMockEvent, resetMockPayments } from './mock-adapter'
export {
  HANDLED_STRIPE_EVENT_TYPES,
  STRIPE_EVENT_EFFECTS,
  isHandledStripeEventType,
  effectForStripeEvent,
} from './events'
export type { HandledStripeEventType, StripeInternalEffect } from './events'
