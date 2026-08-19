/**
 * Contract between the Stripe webhook route (owned by this module) and the
 * carrier/customer invoicing domain (owned by the finance agent).
 *
 * The webhook route (`src/app/api/webhooks/stripe/route.ts`) recognizes two
 * families of Stripe events:
 *
 *  1. Subscription-domain events (`customer.subscription.*`, `invoice.paid`,
 *     `invoice.payment_failed`) — these are the tenant's OWN SaaS billing
 *     relationship with Goliath Dispatch and are handled completely inside
 *     `src/server/tenants/subscription.ts`. The finance module has no part
 *     in these.
 *
 *  2. Payment-domain events (`payment_intent.succeeded`,
 *     `payment_intent.payment_failed`, `charge.refunded`,
 *     `charge.dispute.created`) — these are raised by PaymentIntents the
 *     FINANCE module creates when a customer or carrier pays or is refunded
 *     for an invoice/settlement *inside* a tenant. This module owns Stripe
 *     plumbing and idempotency but not the invoicing domain, so it calls
 *     into whatever implements this interface instead of touching the
 *     `invoices` / `payments` tables directly.
 *
 * ## The contract
 *
 * For effect (2) to route correctly, the finance module MUST set the
 * following keys in `metadata` on every PaymentIntent it creates via
 * `getPaymentProvider().createPaymentIntent()`:
 *
 *   - `tenantId`   — the owning tenant's UUID.
 *   - `invoiceId`  — the finance module's own `invoices.id` (or
 *                    `carrier_settlements.id` for a settlement payout) the
 *                    payment is for.
 *   - `kind`       — one of `'customer_invoice' | 'carrier_settlement'`,
 *                    so a single handler can distinguish the two ledgers.
 *
 * At startup, the finance module calls `registerInvoicePaymentEffects()`
 * with its implementation (a module-level side effect on import is fine —
 * Next.js keeps that module warm for the life of the server process). If no
 * implementation has registered by the time an event of this family arrives
 * — most likely because the finance module has not shipped yet — the
 * webhook route does NOT throw and does NOT drop the event: it stores the
 * `stripe_events` row with `processingStatus = 'received'` (rather than
 * `'processed'`) so a later replay job can re-run it once the finance module
 * is registered. Losing a payment event silently is worse than processing it
 * late.
 */

export interface CarrierInvoicePaymentEvent {
  tenantId: string
  invoiceId: string
  kind: 'customer_invoice' | 'carrier_settlement' | 'unknown'
  stripeEventId: string
  stripeEventType: string
  paymentIntentId: string | null
  chargeId: string | null
  amountCents: number
  currency: string
  occurredAt: Date
  raw: Record<string, unknown>
}

export interface InvoicePaymentEffects {
  /** `payment_intent.succeeded` for an invoice/settlement PaymentIntent. */
  recordPaymentSucceeded(event: CarrierInvoicePaymentEvent): Promise<void>
  /** `payment_intent.payment_failed`. */
  recordPaymentFailed(event: CarrierInvoicePaymentEvent & { failureReason: string | null }): Promise<void>
  /** `charge.refunded`. */
  recordRefund(event: CarrierInvoicePaymentEvent & { refundId: string | null }): Promise<void>
  /** `charge.dispute.created`. */
  recordDispute(event: CarrierInvoicePaymentEvent & { disputeId: string | null }): Promise<void>
}

let registered: InvoicePaymentEffects | null = null

/** Called once by the finance module to plug itself into the webhook route. */
export function registerInvoicePaymentEffects(impl: InvoicePaymentEffects): void {
  registered = impl
}

export function getInvoicePaymentEffects(): InvoicePaymentEffects | null {
  return registered
}

/** Test-only: clears the registration between test files. */
export function resetInvoicePaymentEffects(): void {
  registered = null
}

/**
 * Reads the three required metadata keys off a Stripe PaymentIntent/Charge
 * object. Returns `null` when any are absent — the caller treats that as
 * "cannot be routed" rather than guessing.
 */
export function extractInvoiceMetadata(
  object: Record<string, unknown>,
): { tenantId: string; invoiceId: string; kind: CarrierInvoicePaymentEvent['kind'] } | null {
  const metadata = (object.metadata ?? {}) as Record<string, unknown>
  const tenantId = typeof metadata.tenantId === 'string' ? metadata.tenantId : null
  const invoiceId = typeof metadata.invoiceId === 'string' ? metadata.invoiceId : null
  if (!tenantId || !invoiceId) return null
  const kind =
    metadata.kind === 'customer_invoice' || metadata.kind === 'carrier_settlement'
      ? metadata.kind
      : 'unknown'
  return { tenantId, invoiceId, kind }
}
