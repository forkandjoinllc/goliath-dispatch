import { test, expect } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { createCustomer } from './support/customer'
import { createLoad, assignCarrier, advanceLoadStatus, uploadLoadDocument } from './support/loads'
import { runJobs } from './support/jobs'
import { expectToast } from './support/toast'
import { db, eq, schema } from './support/db'

/**
 * Flow 14 — the system drafts an invoice and a carrier settlement.
 *
 * A load's `pod_received` transition enqueues `invoice.draft_from_pod`
 * (`src/server/loads/service.ts`) — draining that job (`runJobs`, hitting
 * the same `/api/cron/drain` route Vercel Cron calls) creates the draft
 * dispatch-fee invoice deterministically without sleeping for a real cron
 * tick. Generating a settlement is a separate, manual, period-based action
 * (`generateSettlementForPeriod` — distinct from `invoices`: an invoice is
 * Goliath Dispatch billing the CARRIER its dispatch fee, a settlement is
 * what the carrier is OWED for the loads it hauled) driven for real through
 * `/app/settlements/new`.
 *
 * Uses the seeded, reliably-compliant "Permian Basin Transport LLC" carrier
 * (see `10-rate-confirmation.spec.ts`'s doc comment) so the load can walk
 * all the way to `pod_received` without building a fresh compliant carrier
 * — `dispatchGateOk` only strictly requires carrier compliance (an empty
 * resource-assignment list trivially passes), so this test never assigns a
 * truck/driver, unlike `12-driver-pod-upload.spec.ts`.
 */
test.describe('System drafts invoice and settlement', () => {
  test('pod_received drafts a dispatch-fee invoice via the job queue; Accounting can then generate a carrier settlement for the period', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const stamp = Date.now()
    const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await login(page, TENANT_A.admin.email)

    const customerName = `Invoice Shipper ${stamp}`
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

    const load = await db.query.loads.findFirst({ where: eq(schema.loads.id, loadId) })
    expect(load?.status).toBe('pod_received')

    // ── Drain the job queue — the same route Vercel Cron hits once a
    // minute — instead of sleeping for a real tick. ──
    await runJobs(request)

    const invoice = await db.query.invoices.findFirst({ where: eq(schema.invoices.loadId, loadId) })
    expect(invoice).toBeTruthy()
    expect(invoice?.status).toBe('draft')
    expect(invoice?.carrierId).toBe(load?.carrierId)
    expect(invoice?.totalCents).toBeGreaterThan(0)
    expect(invoice?.balanceCents).toBe(invoice?.totalCents)

    const lineItems = await db.query.invoiceLineItems.findMany({
      where: eq(schema.invoiceLineItems.invoiceId, invoice!.id),
    })
    expect(lineItems.some((line) => line.kind === 'dispatch_fee')).toBe(true)

    // A second drain must not create a second invoice for the same load —
    // `createDraftInvoiceForLoad` is idempotent on top of the job queue's
    // own per-load dedupe key.
    await runJobs(request)
    const invoicesForLoad = await db.query.invoices.findMany({ where: eq(schema.invoices.loadId, loadId) })
    expect(invoicesForLoad).toHaveLength(1)

    // ── The UI reflects the drafted invoice. ──
    await page.goto(`/en/app/invoices/${invoice!.id}`)
    await waitForHydration(page)
    await expect(page.getByText(invoice!.invoiceNumber)).toBeVisible()
    await expect(page.getByText(/^draft$/i).first()).toBeVisible()

    // ── Accounting generates a carrier settlement covering this load's
    // period — a separate, manual, period-based action. ──
    await login(page, TENANT_A.accounting.email)
    await page.goto('/en/app/settlements/new')
    await waitForHydration(page)
    const carrierCombobox = page.getByRole('combobox', { name: /carrier/i })
    await carrierCombobox.fill('Permian')
    await page.getByRole('option', { name: /Permian Basin Transport LLC/i }).click()
    await page.locator('input[name="periodStart"]').fill(periodStart.toISOString().slice(0, 10))
    await page.locator('input[name="periodEnd"]').fill(periodEnd.toISOString().slice(0, 10))
    await page.getByRole('button', { name: /^generate settlement$/i }).click()
    await expect(page).toHaveURL(/\/app\/settlements\/[0-9a-f-]+/, { timeout: 15_000 })

    const settlementId = page.url().match(/settlements\/([0-9a-f-]+)/)![1]!
    const settlement = await db.query.carrierSettlements.findFirst({ where: eq(schema.carrierSettlements.id, settlementId) })
    expect(settlement?.status).toBe('draft')
    expect(settlement?.carrierId).toBe(load?.carrierId)
    expect(settlement?.netAmountCents).toBeGreaterThan(0)

    const settlementLines = await db.query.carrierSettlementLines.findMany({
      where: eq(schema.carrierSettlementLines.settlementId, settlementId),
    })
    expect(settlementLines.some((line) => line.loadId === loadId)).toBe(true)

    await expect(page.getByText(settlement!.settlementNumber)).toBeVisible()
  })
})
