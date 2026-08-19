import { createHmac } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { createCustomer } from './support/customer'
import { createLoad, assignCarrier, advanceLoadStatus, uploadLoadDocument } from './support/loads'
import { runJobs } from './support/jobs'
import { expectToast } from './support/toast'
import { db, eq, schema, getTenantBySlug } from './support/db'

/**
 * Flow 15 — carrier pays an invoice through the mock Stripe integration.
 *
 * Two things are exercised:
 *  1. The real "Submit test payment" UI button (`PayNowPanel`), which drives
 *     `payInvoiceWithMockCardAction` → `emitMockEvent` → a real signed POST
 *     to `/api/webhooks/stripe` — the same route production Stripe calls,
 *     not a bypass.
 *  2. Webhook delivery idempotency itself, directly: this test signs its
 *     own `payment_intent.succeeded` event with the exact HMAC scheme
 *     `constructWebhookEvent` verifies against (`STRIPE_WEBHOOK_SECRET`,
 *     default `whsec_placeholder` — see `.env`/`src/lib/env.ts`) and POSTs
 *     the identical `rawBody`/signature to the webhook route twice, proving
 *     the second (a stand-in for a Stripe retry — "Stripe retries on
 *     anything but 2xx") is rejected as a duplicate by the unique index on
 *     `stripe_events.stripe_event_id` and never double-credits the invoice.
 *     This can't be exercised through the UI alone since a fresh UI payment
 *     always mints a fresh event id.
 */

const STRIPE_WEBHOOK_SECRET = 'whsec_placeholder'

function signMockStripeEvent(type: string, object: Record<string, unknown>): { rawBody: string; signature: string; eventId: string } {
  const eventId = `evt_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const createdAt = Math.floor(Date.now() / 1000)
  const rawBody = JSON.stringify({ id: eventId, type, created: createdAt, livemode: false, data: { object } })
  const timestamp = Math.floor(Date.now() / 1000)
  const digest = createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex')
  return { rawBody, signature: `t=${timestamp},v1=${digest}`, eventId }
}

test.describe('Carrier pays via Stripe mock', () => {
  test('a partial webhook delivery is idempotent under retry, then the carrier pays the remaining balance through the UI', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const stamp = Date.now()
    await login(page, TENANT_A.admin.email)

    const customerName = `Payment Shipper ${stamp}`
    await createCustomer(page, { companyName: customerName })
    const loadId = await createLoad(page, {
      customerName,
      stops: [
        { stopType: 'pickup', facilityName: 'Origin DC', line1: '100 Dock Rd', city: 'Waco', state: 'TX', postalCode: '76701' },
        { stopType: 'delivery', facilityName: 'Destination DC', line1: '200 Depot Ave', city: 'Tyler', state: 'TX', postalCode: '75701' },
      ],
      financials: { customerChargeDollars: 3000, carrierGrossRateDollars: 2500, carrierDispatchFeePercent: 10 },
    })
    await assignCarrier(page, loadId, 'Permian Basin Transport LLC')
    await advanceLoadStatus(page, loadId, [
      'available',
      'assigned',
      'dispatched',
      'en_route_to_pickup',
      'at_pickup',
      'in_transit',
      'at_delivery',
      'delivered',
    ])
    await uploadLoadDocument(page, loadId, 'pod')

    await login(page, TENANT_A.accounting.email)
    await page.goto(`/en/app/loads/${loadId}`)
    await waitForHydration(page)
    await page.getByRole('tab', { name: /documents/i }).click()
    const podRow = page.locator('li').filter({ hasText: /proof of delivery/i })
    await podRow.getByRole('button', { name: /^review document$/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^approve$/i }).click()
    await expectToast(page, /^approve$/i)

    await login(page, TENANT_A.admin.email)
    await advanceLoadStatus(page, loadId, ['pod_received'])
    await runJobs(request)

    const invoice = await db.query.invoices.findFirst({ where: eq(schema.invoices.loadId, loadId) })
    expect(invoice).toBeTruthy()
    expect(invoice!.totalCents).toBeGreaterThan(0)

    // ── Admin sends the invoice — required before it's payable (`PayNowPanel`
    // is only shown once `status !== 'draft'`). `SendInvoiceButton` confirms
    // through a native `window.confirm`, which Playwright auto-dismisses
    // unless a handler explicitly accepts it. ──
    page.once('dialog', (dialog) => dialog.accept())
    await page.goto(`/en/app/invoices/${invoice!.id}`)
    await waitForHydration(page)
    await page.getByRole('button', { name: /^send invoice$/i }).click()
    await expectToast(page, /sent/i)

    const sentInvoice = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoice!.id) })
    expect(sentInvoice?.status).toBe('sent')

    // ── Directly sign and deliver a partial `payment_intent.succeeded`
    // event, twice with an identical body/signature, to prove the webhook
    // route's own dedupe (not any business-level guard) is what stops the
    // retry from double-crediting. ──
    const tenant = await getTenantBySlug(TENANT_A.slug)
    const partialAmountCents = Math.floor(invoice!.totalCents / 3)
    const partialIntentId = `pi_e2e_${stamp}`
    const { rawBody, signature, eventId } = signMockStripeEvent('payment_intent.succeeded', {
      id: partialIntentId,
      amount: partialAmountCents,
      currency: 'usd',
      metadata: { tenantId: tenant!.id, invoiceId: invoice!.id, kind: 'customer_invoice' },
    })

    const first = await request.post('/api/webhooks/stripe', {
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      data: rawBody,
    })
    expect(first.ok()).toBeTruthy()
    expect(await first.json()).toMatchObject({ received: true, status: 'processed' })

    const afterFirst = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoice!.id) })
    expect(afterFirst?.amountPaidCents).toBe(partialAmountCents)
    expect(afterFirst?.balanceCents).toBe(invoice!.totalCents - partialAmountCents)

    const paymentsAfterFirst = await db.query.payments.findMany({ where: eq(schema.payments.invoiceId, invoice!.id) })
    expect(paymentsAfterFirst).toHaveLength(1)

    // ── Retry: the exact same event id/body/signature, standing in for a
    // Stripe redelivery. Must be rejected as a duplicate and must not
    // double-credit the invoice. ──
    const retry = await request.post('/api/webhooks/stripe', {
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      data: rawBody,
    })
    expect(retry.ok()).toBeTruthy()
    expect(await retry.json()).toMatchObject({ received: true, duplicate: true })

    const afterRetry = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoice!.id) })
    expect(afterRetry?.amountPaidCents).toBe(partialAmountCents)
    expect(afterRetry?.balanceCents).toBe(invoice!.totalCents - partialAmountCents)

    const paymentsAfterRetry = await db.query.payments.findMany({ where: eq(schema.payments.invoiceId, invoice!.id) })
    expect(paymentsAfterRetry).toHaveLength(1)

    const stripeEventRows = await db.query.stripeEvents.findMany({ where: eq(schema.stripeEvents.stripeEventId, eventId) })
    expect(stripeEventRows).toHaveLength(1)
    expect(stripeEventRows[0]?.processingStatus).toBe('processed')

    // ── The carrier pays the remaining balance for real, through the UI. ──
    await login(page, TENANT_A.carrierUserPermian.email)
    await page.goto(`/en/app/invoices/${invoice!.id}`)
    await waitForHydration(page)
    await expect(page.getByRole('button', { name: /^submit test payment$/i })).toBeVisible()
    await page.getByRole('button', { name: /^submit test payment$/i }).click()
    await expectToast(page, /^payment submitted\.?$/i)

    const paidInvoice = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoice!.id) })
    expect(paidInvoice?.status).toBe('paid')
    expect(paidInvoice?.balanceCents).toBe(0)
    expect(paidInvoice?.amountPaidCents).toBe(invoice!.totalCents)

    const allPayments = await db.query.payments.findMany({ where: eq(schema.payments.invoiceId, invoice!.id) })
    expect(allPayments).toHaveLength(2)

    // The now-fully-paid invoice no longer offers a "Pay now" panel.
    await page.reload()
    await waitForHydration(page)
    await expect(page.getByRole('button', { name: /^submit test payment$/i })).not.toBeVisible()
  })
})
