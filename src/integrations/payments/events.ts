/**
 * The webhook event types this application actually handles, and the
 * internal effect each one triggers. `src/jobs/` (Stripe webhook processing)
 * is the caller — this module only names the contract, it performs no
 * persistence itself (see the "no database access from this layer" rule).
 */

export const HANDLED_STRIPE_EVENT_TYPES = [
  'invoice.paid',
  'invoice.payment_failed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const

export type HandledStripeEventType = (typeof HANDLED_STRIPE_EVENT_TYPES)[number]

export type StripeInternalEffect =
  | 'invoice.mark_paid'
  | 'invoice.mark_payment_failed'
  | 'payment.mark_succeeded'
  | 'payment.mark_failed'
  | 'payment.mark_refunded'
  | 'payment.flag_disputed'
  | 'subscription.sync'
  | 'subscription.mark_cancelled'

export const STRIPE_EVENT_EFFECTS: Record<HandledStripeEventType, StripeInternalEffect> = {
  'invoice.paid': 'invoice.mark_paid',
  'invoice.payment_failed': 'invoice.mark_payment_failed',
  'payment_intent.succeeded': 'payment.mark_succeeded',
  'payment_intent.payment_failed': 'payment.mark_failed',
  'charge.refunded': 'payment.mark_refunded',
  'charge.dispute.created': 'payment.flag_disputed',
  'customer.subscription.created': 'subscription.sync',
  'customer.subscription.updated': 'subscription.sync',
  'customer.subscription.deleted': 'subscription.mark_cancelled',
}

export function isHandledStripeEventType(type: string): type is HandledStripeEventType {
  return (HANDLED_STRIPE_EVENT_TYPES as readonly string[]).includes(type)
}

/** Returns `null` for a real Stripe event type this app deliberately ignores. */
export function effectForStripeEvent(type: string): StripeInternalEffect | null {
  return isHandledStripeEventType(type) ? STRIPE_EVENT_EFFECTS[type] : null
}
