import { createHmac } from 'node:crypto'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { createCustomer } from './support/customer'
import { createLoad, assignCarrier, advanceLoadStatus, uploadLoadDocument } from './support/loads'
import { runJobs } from './support/jobs'
import { expectToast } from './support/toast'
import { db, eq, desc, and, schema, getUserByEmail } from './support/db'

/**
 * Flow 16 — reports reflect a real transaction.
 *
 * The Revenue & margin report (`revenue_margin`) reads from
 * `financial_snapshots`, which is only computed once a load's draft invoice
 * is created (`createDraftInvoiceForLoad` → `onFinancialInputChanged`) — so
 * this drives the same load-to-`pod_received` chain as flows 14/15, then
 * checks the report reflects it grouped by customer, for both a
 * tenant-scoped actor (Admin, sees margin) and a carrier-scoped actor
 * (Permian's portal user, must NOT see margin/customer-charge — see
 * `revenue-margin.ts`'s `CARRIER_COLUMNS` comment: "A carrier must never see
 * tenant margin or the customer's charge"). Both the on-screen table AND
 * the actual downloaded CSV bytes are checked for the carrier case, since a
 * column that's merely hidden client-side would still leak the data —
 * `ReportTable`'s own comment confirms the server never sends the column in
 * the first place, and this test proves that holds through a real export
 * too.
 *
 * The CSV bytes are fetched by directly signing a local-storage download URL
 * (`src/lib/storage/local-driver.ts`'s exact HMAC scheme, over
 * `AUTH_SECRET` — the same technique `14-invoice-payment-stripe-mock.spec.ts`
 * uses for the Stripe webhook secret) rather than clicking "Download" and
 * chasing the resulting `window.open` popup — `window.open(url, '_blank',
 * 'noopener')`'s popup is unreliable to intercept via `page.waitForEvent`
 * across browsers/CI, and a directly-signed request hits the exact same
 * real, signature-verified route (`/api/documents/local/[...key]`) either
 * way.
 */

const AUTH_SECRET = '2iaQuYwHfjB9LF8veiAumnUyrz52dlnsj3Y0byCV7bo='
const LOCAL_STORAGE_SIGNATURE_DOMAIN = 'goliath-local-storage:v1'

function signLocalDownloadUrl(key: string): string {
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + 300
  const signature = createHmac('sha256', AUTH_SECRET)
    .update(`${LOCAL_STORAGE_SIGNATURE_DOMAIN}:download:${key}:${expiresAtSeconds}`)
    .digest('hex')
  const encodedKey = key.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `/api/documents/local/${encodedKey}?exp=${expiresAtSeconds}&sig=${signature}`
}

async function findLatestExportJob(userEmail: string) {
  const user = await getUserByEmail(userEmail)
  return db.query.exportJobs.findFirst({
    where: and(
      eq(schema.exportJobs.requestedByUserId, user!.id),
      eq(schema.exportJobs.reportKey, 'revenue_margin'),
      eq(schema.exportJobs.format, 'csv'),
    ),
    orderBy: desc(schema.exportJobs.createdAt),
  })
}

/**
 * `requestExportAction` runs inside a `startTransition` with no toast/UI
 * feedback for the "queued" state (only the terminal succeeded/failed
 * state toasts, via client polling) — clicking "CSV" doesn't guarantee the
 * server action has actually inserted the `export_jobs`/`job_queue` rows by
 * the time control returns to the test, so poll for the row to exist before
 * draining the queue for it.
 */
async function waitForExportJobQueued(userEmail: string): Promise<void> {
  await expect.poll(async () => (await findLatestExportJob(userEmail)) !== undefined, { timeout: 10_000 }).toBe(true)
}

async function fetchLatestCsvExport(request: APIRequestContext, userEmail: string): Promise<string> {
  const job = await findLatestExportJob(userEmail)
  expect(job?.status).toBe('succeeded')
  expect(job?.storageKey).toBeTruthy()
  const response = await request.get(signLocalDownloadUrl(job!.storageKey!))
  expect(response.ok()).toBeTruthy()
  return response.text()
}

test.describe('Reports reflect transaction', () => {
  test('a delivered, invoiced load appears in the revenue & margin report, with carrier-scoped exports excluding margin', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const stamp = Date.now()
    await login(page, TENANT_A.admin.email)

    const customerName = `Reporting Shipper ${stamp}`
    await createCustomer(page, { companyName: customerName })
    const loadId = await createLoad(page, {
      customerName,
      stops: [
        { stopType: 'pickup', facilityName: 'Origin DC', line1: '100 Dock Rd', city: 'Waco', state: 'TX', postalCode: '76701' },
        { stopType: 'delivery', facilityName: 'Destination DC', line1: '200 Depot Ave', city: 'Tyler', state: 'TX', postalCode: '75701' },
      ],
      financials: { customerChargeDollars: 4000, carrierGrossRateDollars: 3000, carrierDispatchFeePercent: 10 },
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
    await page.locator('li').filter({ hasText: /proof of delivery/i }).getByRole('button', { name: /^review document$/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^approve$/i }).click()
    await expectToast(page, /^approve$/i)

    await login(page, TENANT_A.admin.email)
    await advanceLoadStatus(page, loadId, ['pod_received'])
    await runJobs(request)

    const snapshot = await db.query.financialSnapshots.findFirst({
      where: eq(schema.financialSnapshots.loadId, loadId),
      orderBy: desc(schema.financialSnapshots.version),
    })
    expect(snapshot).toBeTruthy()
    expect(snapshot!.customerChargeCents).toBe(400_000)
    expect(snapshot!.carrierGrossRateCents).toBe(300_000)
    expect(snapshot!.grossMarginCents).toBeGreaterThan(0)

    // ── Admin: the report shows the load grouped by customer, with margin.
    // Scoped to the real `<table>` — `ReportTable`'s paired chart also
    // renders a visually-hidden (`sr-only`, still laid out so `:visible`
    // alone doesn't exclude it) accessible data table with unformatted
    // numbers, which would otherwise double-match. ──
    await page.goto('/en/app/reports/revenue_margin')
    await waitForHydration(page)
    await page.getByRole('button', { name: /^customer$/i }).click()
    await waitForHydration(page)
    const customerRow = page.locator('table:not(.sr-only)').locator('tr').filter({ hasText: customerName })
    await expect(customerRow).toBeVisible()
    await expect(customerRow).toContainText('$4,000.00')
    await expect(customerRow).toContainText('$3,000.00')

    // ── Admin exports as CSV and the file itself contains the margin
    // column and this load's numbers. ──
    await page.getByRole('button', { name: /^csv$/i }).click()
    await waitForExportJobQueued(TENANT_A.admin.email)
    await runJobs(request)
    const adminCsvText = await fetchLatestCsvExport(request, TENANT_A.admin.email)
    expect(adminCsvText).toContain(customerName)
    expect(adminCsvText.toLowerCase()).toContain('gross margin')
    expect(adminCsvText).toContain('$4,000.00')
    expect(adminCsvText).toContain('$3,000.00')

    // ── Carrier: sees its own gross rate but never the tenant's margin or
    // the customer's charge — neither on screen nor in its own CSV export. ──
    await login(page, TENANT_A.carrierUserPermian.email)
    await page.goto('/en/app/reports/revenue_margin')
    await waitForHydration(page)
    await page.getByRole('button', { name: /^customer$/i }).click()
    await waitForHydration(page)
    const carrierTableText = await page.locator('table:not(.sr-only)').innerText()
    expect(carrierTableText).not.toContain('$4,000.00')
    expect(carrierTableText.toLowerCase()).not.toContain('gross margin')
    expect(carrierTableText.toLowerCase()).not.toContain('customer charge')
    await expect(page.locator('table:not(.sr-only)').locator('tr').filter({ hasText: customerName })).toContainText('$3,000.00')

    await page.getByRole('button', { name: /^csv$/i }).click()
    await waitForExportJobQueued(TENANT_A.carrierUserPermian.email)
    await runJobs(request)
    const carrierCsvText = await fetchLatestCsvExport(request, TENANT_A.carrierUserPermian.email)
    expect(carrierCsvText).toContain('$3,000.00')
    expect(carrierCsvText).not.toContain('$4,000.00')
    expect(carrierCsvText.toLowerCase()).not.toContain('gross margin')
    expect(carrierCsvText.toLowerCase()).not.toContain('customer charge')
  })
})
