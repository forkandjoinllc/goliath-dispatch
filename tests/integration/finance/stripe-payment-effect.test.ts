import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { unsafeDb } from '@/db/client'
import { invoices, payments } from '@/db/schema'
import { tenantDb } from '@/db/tenant-db'
import { emitMockEvent, resetMockPayments } from '@/integrations/payments'
import { createDraftInvoiceForLoad } from '@/server/invoices/service'
import { POST } from '@/app/api/webhooks/stripe/route'
import { createTestCarrier, createTestCustomer, createTestLoad, createTestTenant, createTestUser } from './fixtures'

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

async function setup() {
  const tenant = await createTestTenant()
  const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
  const db = tenantDb(tenant.id)
  const carrier = await createTestCarrier(db, admin.id)
  const customer = await createTestCustomer(db)
  const load = await createTestLoad(db, {
    carrierId: carrier.id,
    customerId: customer.id,
    carrierGrossRateCents: 150_000,
    carrierDispatchFeeBps: 1000,
    status: 'pod_received',
  })
  const invoice = await createDraftInvoiceForLoad(db, load.id)
  await db.update(invoices, invoice.id, { status: 'sent', issueDate: new Date() })
  return { tenant, admin, db, carrier, customer, load, invoice }
}

describe('Stripe payment_intent.succeeded effect', () => {
  beforeEach(() => {
    resetMockPayments()
  })

  it('applied twice for the same payment intent records exactly one payment', async () => {
    const { tenant, invoice } = await setup()

    const { rawBody, signature, eventId } = emitMockEvent('payment_intent.succeeded', {
      id: 'pi_test_1',
      amount: invoice.totalCents,
      currency: 'usd',
      metadata: { tenantId: tenant.id, invoiceId: invoice.id, kind: 'customer_invoice' },
    })

    const first = await postWebhook(rawBody, signature)
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody).toMatchObject({ received: true, status: 'processed' })

    const afterFirst = await unsafeDb.select().from(invoices).where(eq(invoices.id, invoice.id))
    expect(afterFirst[0]?.status).toBe('paid')
    expect(afterFirst[0]?.balanceCents).toBe(0)

    const paymentsAfterFirst = await unsafeDb.select().from(payments).where(eq(payments.invoiceId, invoice.id))
    expect(paymentsAfterFirst).toHaveLength(1)
    expect(paymentsAfterFirst[0]?.amountCents).toBe(invoice.totalCents)

    // Same event id, same body: the webhook route's own dedupe short-circuits.
    const second = await postWebhook(rawBody, signature)
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody).toMatchObject({ received: true, duplicate: true })

    const paymentsAfterSecond = await unsafeDb.select().from(payments).where(eq(payments.invoiceId, invoice.id))
    expect(paymentsAfterSecond).toHaveLength(1)

    // A DIFFERENT Stripe event id, but the SAME payment intent id, must also
    // not double-apply — this is the effect's own idempotency, independent
    // of the webhook route's stripe_events dedupe by event id.
    const { rawBody: replayBody, signature: replaySignature } = emitMockEvent('payment_intent.succeeded', {
      id: 'pi_test_1',
      amount: invoice.totalCents,
      currency: 'usd',
      metadata: { tenantId: tenant.id, invoiceId: invoice.id, kind: 'customer_invoice' },
    })
    expect(replayBody).not.toContain(eventId) // sanity: this really is a new event id

    const third = await postWebhook(replayBody, replaySignature)
    expect(third.status).toBe(200)

    const paymentsAfterThird = await unsafeDb.select().from(payments).where(eq(payments.invoiceId, invoice.id))
    expect(paymentsAfterThird).toHaveLength(1)

    const invoiceAfterThird = await unsafeDb.select().from(invoices).where(eq(invoices.id, invoice.id))
    expect(invoiceAfterThird[0]?.amountPaidCents).toBe(invoice.totalCents)
  })
})
