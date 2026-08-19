import { beforeEach, describe, expect, it } from 'vitest'
import { MockPaymentAdapter, emitMockEvent, resetMockPayments } from '@/integrations/payments/mock-adapter'

describe('MockPaymentAdapter webhook signature verification', () => {
  beforeEach(() => resetMockPayments())

  it('verifies a correctly-signed event and normalizes it', () => {
    const adapter = new MockPaymentAdapter()
    const { rawBody, signature } = emitMockEvent('invoice.paid', { id: 'in_mock_1', amount_paid: 5000 })

    const event = adapter.constructWebhookEvent(rawBody, signature)

    expect(event.type).toBe('invoice.paid')
    expect(event.data).toMatchObject({ id: 'in_mock_1', amount_paid: 5000 })
    expect(event.livemode).toBe(false)
  })

  it('rejects a tampered body even when the signature header is unchanged', () => {
    const adapter = new MockPaymentAdapter()
    const { rawBody, signature } = emitMockEvent('payment_intent.succeeded', { id: 'pi_mock_1' })

    const tampered = rawBody.replace('pi_mock_1', 'pi_mock_evil')

    expect(() => adapter.constructWebhookEvent(tampered, signature)).toThrow()
  })

  it('rejects a tampered signature even when the body is unchanged', () => {
    const adapter = new MockPaymentAdapter()
    const { rawBody, signature } = emitMockEvent('charge.refunded', { id: 'ch_mock_1' })

    const [t, v1] = signature.split(',')
    const tamperedSignature = `${t},v1=${(v1 ?? '').replace('v1=', '')}deadbeef`

    expect(() => adapter.constructWebhookEvent(rawBody, tamperedSignature)).toThrow()
  })

  it('rejects a signature missing required parts', () => {
    const adapter = new MockPaymentAdapter()
    const { rawBody } = emitMockEvent('invoice.payment_failed', { id: 'in_mock_2' })
    expect(() => adapter.constructWebhookEvent(rawBody, 'garbage')).toThrow()
  })

  it('retrieveEvent finds an event previously emitted', async () => {
    const adapter = new MockPaymentAdapter()
    const { eventId } = emitMockEvent('customer.subscription.updated', { id: 'sub_mock_1' })
    const event = await adapter.retrieveEvent(eventId)
    expect(event.id).toBe(eventId)
    expect(event.type).toBe('customer.subscription.updated')
  })

  it('retrieveEvent throws for an unknown event id', async () => {
    const adapter = new MockPaymentAdapter()
    await expect(adapter.retrieveEvent('evt_mock_does_not_exist')).rejects.toThrow()
  })
})

describe('MockPaymentAdapter deterministic ids', () => {
  beforeEach(() => resetMockPayments())

  it('produces predictable, incrementing mock ids', async () => {
    const adapter = new MockPaymentAdapter()
    const customerA = await adapter.createCustomer({ tenantId: 't1', email: 'a@example.com', name: 'A' })
    const customerB = await adapter.createCustomer({ tenantId: 't1', email: 'b@example.com', name: 'B' })
    expect(customerA.customerId).toBe('cus_mock_1')
    expect(customerB.customerId).toBe('cus_mock_2')
  })

  it('supports the full subscription lifecycle', async () => {
    const adapter = new MockPaymentAdapter()
    const customer = await adapter.createCustomer({ tenantId: 't1', email: 'a@example.com', name: 'A' })
    const sub = await adapter.createSubscription({ customerId: customer.customerId, priceId: 'price_growth' })
    expect(sub.status).toBe('active')

    const updated = await adapter.updateSubscription({ subscriptionId: sub.subscriptionId, cancelAtPeriodEnd: true })
    expect(updated.cancelAtPeriodEnd).toBe(true)

    const cancelled = await adapter.cancelSubscription({ subscriptionId: sub.subscriptionId })
    expect(cancelled.status).toBe('canceled')
  })

  it('supports a payment intent + full refund round trip', async () => {
    const adapter = new MockPaymentAdapter()
    const pi = await adapter.createPaymentIntent({ amountCents: 10_000 })
    expect(pi.status).toBe('requires_payment_method')
    const refund = await adapter.createRefund({ paymentIntentId: pi.paymentIntentId })
    expect(refund.amountCents).toBe(10_000)
    expect(refund.status).toBe('succeeded')
  })
})
