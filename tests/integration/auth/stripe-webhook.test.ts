import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { unsafeDb } from '@/db/client'
import { auditEvents, stripeEvents, tenantSubscriptions, tenants } from '@/db/schema'
import { emitMockEvent, resetMockPayments } from '@/integrations/payments'
import { ensureDefaultPlans, getPlanByCode } from '@/server/tenants/queries'
import { createSubscriptionForTenant } from '@/server/tenants/subscription'
import { POST } from '@/app/api/webhooks/stripe/route'
import { createTestTenant } from './fixtures'

const WEBHOOK_URL = 'http://localhost/api/webhooks/stripe'

function postWebhook(rawBody: string, signature: string): Promise<Response> {
  return POST(
    new NextRequest(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: rawBody,
    }),
  )
}

describe('Stripe webhook intake', () => {
  beforeEach(() => {
    resetMockPayments()
  })

  it('rejects a request with no signature header before touching the database', async () => {
    const response = await POST(
      new NextRequest(WEBHOOK_URL, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('missing_signature')
  })

  it('rejects a request with an invalid signature and never records the event', async () => {
    const { rawBody } = emitMockEvent('customer.subscription.updated', { id: 'sub_mock_1', status: 'past_due' })

    const response = await postWebhook(rawBody, 't=1700000000,v1=deadbeefdeadbeef')
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('invalid_signature')

    const rows = await unsafeDb.select().from(stripeEvents)
    expect(rows).toHaveLength(0)
  })

  it('applies a subscription event exactly once even when the same event is delivered twice (idempotency)', async () => {
    await ensureDefaultPlans()
    const plan = await getPlanByCode('starter')
    expect(plan).not.toBeNull()

    const tenant = await createTestTenant()
    await createSubscriptionForTenant({
      tenantId: tenant.id,
      planCode: plan!.code,
      adminEmail: 'admin@example.test',
      adminName: 'Admin Example',
    })

    const [subscriptionRow] = await unsafeDb
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, tenant.id))
    expect(subscriptionRow).toBeDefined()
    const stripeSubscriptionId = subscriptionRow!.stripeSubscriptionId!

    const { rawBody, signature, eventId } = emitMockEvent('customer.subscription.updated', {
      id: stripeSubscriptionId,
      status: 'past_due',
    })

    const first = await postWebhook(rawBody, signature)
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody).toMatchObject({ received: true, status: 'processed' })

    const [afterFirst] = await unsafeDb
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.id, subscriptionRow!.id))
    expect(afterFirst?.status).toBe('past_due')

    const [tenantAfterFirst] = await unsafeDb.select().from(tenants).where(eq(tenants.id, tenant.id))
    expect(tenantAfterFirst?.status).toBe('past_due')

    const auditRowsAfterFirst = await unsafeDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, tenant.id))
    const relevantAfterFirst = auditRowsAfterFirst.filter((r) => r.tenantId === tenant.id)
    expect(relevantAfterFirst.length).toBeGreaterThan(0)

    // Replay the exact same event — same Stripe event id, same body.
    const second = await postWebhook(rawBody, signature)
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody).toMatchObject({ received: true, duplicate: true })

    // Exactly one stripe_events row for this event id, and the effect was not
    // re-applied a second time.
    const eventRows = await unsafeDb.select().from(stripeEvents).where(eq(stripeEvents.stripeEventId, eventId))
    expect(eventRows).toHaveLength(1)
    expect(eventRows[0]?.processingStatus).toBe('processed')

    const auditRowsAfterSecond = await unsafeDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, tenant.id))
    const relevantAfterSecond = auditRowsAfterSecond.filter((r) => r.tenantId === tenant.id)
    expect(relevantAfterSecond).toHaveLength(relevantAfterFirst.length)
  })

  it('ignores an event type the app does not handle, without erroring', async () => {
    const { rawBody, signature } = emitMockEvent('customer.updated', { id: 'cus_mock_1' })

    const response = await postWebhook(rawBody, signature)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ received: true, status: 'ignored' })
  })

  it('defers a payment-domain event that carries no tenant/invoice metadata, rather than dropping or failing it', async () => {
    const { rawBody, signature } = emitMockEvent('payment_intent.succeeded', {
      id: 'pi_mock_1',
      amount: 5000,
      currency: 'usd',
      metadata: {},
    })

    const response = await postWebhook(rawBody, signature)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ received: true, status: 'deferred' })

    const [row] = await unsafeDb.select().from(stripeEvents).where(eq(stripeEvents.stripeEventId, 'evt_mock_1'))
    // Deferred events stay `received` on purpose so a replay job can find them.
    expect(row?.processingStatus).toBe('received')
  })
})
