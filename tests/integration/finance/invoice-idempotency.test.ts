import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { invoiceLineItems, invoices } from '@/db/schema'
import { tenantDb } from '@/db/tenant-db'
import { createDraftInvoiceForLoad, recordManualPayment } from '@/server/invoices/service'
import type { Actor } from '@/lib/permissions'
import { createTestCarrier, createTestCustomer, createTestLoad, createTestTenant, createTestUser } from './fixtures'

function actorFor(userId: string): Actor {
  return { userId } as unknown as Actor
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
    customerChargeCents: 200_000,
    carrierGrossRateCents: 150_000,
    carrierDispatchFeeBps: 1000,
    status: 'pod_received',
  })
  return { tenant, admin, db, carrier, customer, load }
}

describe('createDraftInvoiceForLoad', () => {
  it('is idempotent: a second call returns the existing draft rather than creating a duplicate', async () => {
    const { db, load } = await setup()

    const first = await createDraftInvoiceForLoad(db, load.id)
    expect(first.status).toBe('draft')
    // 150,000 * 10% = 15,000 dispatch fee, no deductions -> total is the fee alone.
    expect(first.totalCents).toBe(15_000)
    expect(first.balanceCents).toBe(15_000)

    const second = await createDraftInvoiceForLoad(db, load.id)
    expect(second.id).toBe(first.id)
    expect(second.invoiceNumber).toBe(first.invoiceNumber)

    const rows = await unsafeDb.select().from(invoices).where(eq(invoices.loadId, load.id))
    expect(rows).toHaveLength(1)

    const lineItems = await unsafeDb.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, first.id))
    expect(lineItems).toHaveLength(1)
    expect(lineItems[0]?.kind).toBe('dispatch_fee')
  })

  it('computes a financial snapshot on the fly when none exists yet', async () => {
    const { db, load } = await setup()
    const invoice = await createDraftInvoiceForLoad(db, load.id)
    expect(invoice.totalCents).toBeGreaterThan(0)
  })
})

describe('partial payment against a real invoice', () => {
  it('a partial payment leaves the invoice open (sent/due) and a second payment completes it', async () => {
    const { db, admin, load } = await setup()
    const draft = await createDraftInvoiceForLoad(db, load.id)
    expect(draft.totalCents).toBe(15_000)

    // Move the draft to "sent" the same way the send action would, without
    // exercising the PDF/email side effects irrelevant to this test.
    await db.update(invoices, draft.id, { status: 'sent', issueDate: new Date() })

    const first = await recordManualPayment(db, actorFor(admin.id), {
      invoiceId: draft.id,
      amountCents: 10_000,
      method: 'check',
      reference: 'CHK-1001',
    })
    expect(first.invoice.status).toBe('sent')
    expect(first.invoice.amountPaidCents).toBe(10_000)
    expect(first.invoice.balanceCents).toBe(5_000)

    const second = await recordManualPayment(db, actorFor(admin.id), {
      invoiceId: draft.id,
      amountCents: 5_000,
      method: 'check',
      reference: 'CHK-1002',
    })
    expect(second.invoice.status).toBe('paid')
    expect(second.invoice.amountPaidCents).toBe(15_000)
    expect(second.invoice.balanceCents).toBe(0)
    expect(second.invoice.paidAt).not.toBeNull()
  })

  it('rejects a manual payment larger than the remaining balance', async () => {
    const { db, admin, load } = await setup()
    const draft = await createDraftInvoiceForLoad(db, load.id)
    await db.update(invoices, draft.id, { status: 'sent', issueDate: new Date() })

    await expect(
      recordManualPayment(db, actorFor(admin.id), { invoiceId: draft.id, amountCents: 999_999, method: 'check' }),
    ).rejects.toMatchObject({ code: 'validation_failed', messageKey: 'finance.validation.overpayment' })
  })
})
