import 'server-only'
import { eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { subscriptionStatusEnum, tenantStatusEnum, tenantSubscriptions, tenants } from '@/db/schema'
import { getPaymentProvider, type SubscriptionStatus, type WebhookEvent } from '@/integrations/payments'
import { logger } from '@/lib/logger'
import { notFound } from '@/lib/errors'
import { recordAudit } from '@/lib/audit'
import type { AuditRequestContext } from '@/lib/audit'
import { getPlanByCode } from './queries'

type InternalSubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number]
type InternalTenantStatus = (typeof tenantStatusEnum.enumValues)[number]

/**
 * Subscription lifecycle: creating the Stripe customer + subscription for a
 * freshly provisioned tenant, and applying the webhook events that keep our
 * copy of subscription/tenant status in sync afterward.
 *
 * Tenant status follows subscription status:
 *  - `trialing` / `active`     → tenant `trialing` / `active` (fully usable)
 *  - `past_due`                → tenant `past_due` (still readable — the
 *                                 product does not lock a tenant out over a
 *                                 single missed payment)
 *  - `suspended` / `unpaid` /
 *    `incomplete_expired`      → tenant `suspended` (login refused)
 *  - `cancelled`                → tenant `cancelled`
 */

const STRIPE_TO_INTERNAL_STATUS: Record<SubscriptionStatus, InternalSubscriptionStatus> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'cancelled',
  incomplete: 'incomplete',
  incomplete_expired: 'cancelled',
  unpaid: 'suspended',
  paused: 'suspended',
}

const INTERNAL_STATUS_TO_TENANT_STATUS: Record<InternalSubscriptionStatus, InternalTenantStatus> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  suspended: 'suspended',
  cancelled: 'cancelled',
  incomplete: 'past_due',
}

export interface CreateSubscriptionForTenantInput {
  tenantId: string
  planCode: string
  adminEmail: string
  adminName: string
}

/**
 * Creates the Stripe customer + subscription for a tenant that already
 * exists. Called after `provisionTenant` commits — never inside its
 * transaction — so a Stripe failure never rolls back a successful signup.
 * A tenant left without a subscription row can have this retried.
 */
export async function createSubscriptionForTenant(input: CreateSubscriptionForTenantInput): Promise<void> {
  const plan = await getPlanByCode(input.planCode)
  if (!plan) throw notFound('errors.notFound', { entity: 'plan' })

  const provider = getPaymentProvider()
  const customer = await provider.createCustomer({
    tenantId: input.tenantId,
    email: input.adminEmail,
    name: input.adminName,
  })

  const priceId = planStripePriceId(input.planCode)
  const subscription = await provider.createSubscription({
    customerId: customer.customerId,
    priceId,
    trialDays: plan.trialDays,
    metadata: { tenantId: input.tenantId, planCode: input.planCode },
  })

  const status = STRIPE_TO_INTERNAL_STATUS[subscription.status]

  await unsafeDb.insert(tenantSubscriptions).values({
    tenantId: input.tenantId,
    planId: plan.id,
    status,
    stripeCustomerId: customer.customerId,
    stripeSubscriptionId: subscription.subscriptionId,
    currentPeriodEnd: subscription.currentPeriodEnd,
    trialEndsAt: status === 'trialing' ? subscription.currentPeriodEnd : null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  })

  await unsafeDb
    .update(tenants)
    .set({ status: INTERNAL_STATUS_TO_TENANT_STATUS[status] })
    .where(eq(tenants.id, input.tenantId))
}

function planStripePriceId(planCode: string): string {
  // Falls back to a synthetic price id so the mock adapter (which does not
  // validate price existence) works out of the box in development and test.
  return `price_${planCode}`
}

/** Applies a `customer.subscription.*` webhook event to our tables. */
export async function handleSubscriptionEvent(
  event: WebhookEvent,
  request: AuditRequestContext,
): Promise<{ handled: boolean; tenantId: string | null }> {
  const object = event.data as { id?: string; status?: SubscriptionStatus; customer?: string; current_period_end?: number; cancel_at_period_end?: boolean }
  const stripeSubscriptionId = object.id
  if (!stripeSubscriptionId) return { handled: false, tenantId: null }

  const existing = await unsafeDb
    .select({ id: tenantSubscriptions.id, tenantId: tenantSubscriptions.tenantId, status: tenantSubscriptions.status })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!existing) {
    logger.warn('stripe webhook: subscription not found locally', { stripeSubscriptionId })
    return { handled: false, tenantId: null }
  }

  const isDeleted = event.type === 'customer.subscription.deleted'
  const nextStatus: InternalSubscriptionStatus = isDeleted
    ? 'cancelled'
    : STRIPE_TO_INTERNAL_STATUS[object.status ?? 'active']

  await unsafeDb
    .update(tenantSubscriptions)
    .set({
      status: nextStatus,
      currentPeriodEnd: object.current_period_end ? new Date(object.current_period_end * 1000) : undefined,
      cancelAtPeriodEnd: object.cancel_at_period_end ?? undefined,
      cancelledAt: isDeleted ? new Date() : undefined,
      pastDueSince: nextStatus === 'past_due' ? new Date() : null,
    })
    .where(eq(tenantSubscriptions.id, existing.id))

  const tenantStatus = INTERNAL_STATUS_TO_TENANT_STATUS[nextStatus]
  await unsafeDb.update(tenants).set({ status: tenantStatus }).where(eq(tenants.id, existing.tenantId))

  const auditAction = tenantStatus === 'suspended' ? 'tenant.suspended' : tenantStatus === 'active' && existing.status !== 'active' ? 'tenant.reactivated' : 'tenant.updated'
  await recordAudit(null, request, {
    action: auditAction,
    entityType: 'tenant',
    entityId: existing.tenantId,
    tenantId: existing.tenantId,
    metadata: { subscriptionStatus: nextStatus, stripeEventType: event.type },
  })

  return { handled: true, tenantId: existing.tenantId }
}

/** Applies an `invoice.paid` / `invoice.payment_failed` Stripe Billing event (the tenant's own SaaS bill, not a carrier invoice). */
export async function handleSubscriptionInvoiceEvent(
  event: WebhookEvent,
  request: AuditRequestContext,
): Promise<{ handled: boolean; tenantId: string | null }> {
  const object = event.data as { subscription?: string; customer?: string }
  const stripeSubscriptionId = object.subscription
  const stripeCustomerId = object.customer

  const existing = await unsafeDb
    .select({ id: tenantSubscriptions.id, tenantId: tenantSubscriptions.tenantId })
    .from(tenantSubscriptions)
    .where(
      stripeSubscriptionId
        ? eq(tenantSubscriptions.stripeSubscriptionId, stripeSubscriptionId)
        : eq(tenantSubscriptions.stripeCustomerId, stripeCustomerId ?? ''),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!existing) return { handled: false, tenantId: null }

  if (event.type === 'invoice.payment_failed') {
    await unsafeDb
      .update(tenantSubscriptions)
      .set({ status: 'past_due', pastDueSince: new Date() })
      .where(eq(tenantSubscriptions.id, existing.id))
    await unsafeDb.update(tenants).set({ status: 'past_due' }).where(eq(tenants.id, existing.tenantId))
    await recordAudit(null, request, {
      action: 'payment.failed',
      entityType: 'tenant_subscription',
      entityId: existing.id,
      tenantId: existing.tenantId,
    })
  } else {
    await unsafeDb
      .update(tenantSubscriptions)
      .set({ status: 'active', pastDueSince: null })
      .where(eq(tenantSubscriptions.id, existing.id))
    await unsafeDb.update(tenants).set({ status: 'active' }).where(eq(tenants.id, existing.tenantId))
    await recordAudit(null, request, {
      action: 'payment.recorded',
      entityType: 'tenant_subscription',
      entityId: existing.id,
      tenantId: existing.tenantId,
    })
  }

  return { handled: true, tenantId: existing.tenantId }
}
