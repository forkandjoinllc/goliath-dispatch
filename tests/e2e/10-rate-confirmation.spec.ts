import { test, expect } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { createCustomer } from './support/customer'
import { createLoad, assignCarrier, uploadLoadDocument } from './support/loads'
import { expectToast } from './support/toast'
import { db, eq, desc, schema } from './support/db'

/**
 * Flow 11 — carrier accepts a rate confirmation. Uses Tenant A's seeded
 * "Permian Basin Transport LLC" carrier and its portal user
 * (`carrierUserPermian`, gregory.nash@example.com) rather than a
 * freshly-built one: there is no UI flow anywhere in the app to create a
 * carrier-portal *login* (`createCarrier` — used by every other flow's
 * fixtures — only creates the tenant-side carrier profile/contact record,
 * not a user account; carrier and driver portal accounts are exclusively
 * seed-created, see `src/db/seed/tenant-a.ts`'s `createSeedUser` calls).
 * Permian was picked over the also-seeded "Summit Heavy Haul LLC" because
 * it's reliably compliant — see `support/compliance.ts`'s doc comment on why
 * Summit's incidental extra seed documents make it an unreliable fixture.
 */
test.describe('Carrier accepts rate confirmation', () => {
  test('the assigned carrier accepts a rate confirmation; the acceptance records actor, timestamp, document version, and hash', async ({
    page,
  }) => {
    const stamp = Date.now()
    await login(page, TENANT_A.admin.email)

    const customerName = `Rate Confirmation Shipper ${stamp}`
    await createCustomer(page, { companyName: customerName })
    const loadId = await createLoad(page, {
      customerName,
      stops: [
        { stopType: 'pickup', facilityName: 'Origin DC', line1: '100 Dock Rd', city: 'Waco', state: 'TX', postalCode: '76701' },
        { stopType: 'delivery', facilityName: 'Destination DC', line1: '200 Depot Ave', city: 'Tyler', state: 'TX', postalCode: '75701' },
      ],
    })
    await assignCarrier(page, loadId, 'Permian Basin Transport LLC')
    await uploadLoadDocument(page, loadId, 'rate_confirmation')

    const documentRow = await db.query.loadDocuments.findFirst({
      where: eq(schema.loadDocuments.loadId, loadId),
      orderBy: desc(schema.loadDocuments.createdAt),
    })
    expect(documentRow?.documentType).toBe('rate_confirmation')

    // ── The carrier's own portal user opens the same load and accepts. ──
    await login(page, TENANT_A.carrierUserPermian.email)
    await page.goto(`/en/app/loads/${loadId}`)
    await waitForHydration(page)
    await page.getByRole('tab', { name: /documents/i }).click()

    await expect(page.getByText(/no rate confirmation has been uploaded/i)).not.toBeVisible()
    await page.getByRole('button', { name: /^accept$/i }).click()
    await expectToast(page, /^accepted$/i)

    // Scoped to the decision-history list (`data-testid`, not a bare
    // `getByText`) — the toast (role="status", "Accepted") and the history
    // entry's own "Accepted" label can both be in the DOM at once (the
    // toast auto-dismisses on a timer, not synchronously with the request
    // resolving), which is a strict-mode violation for an unscoped match.
    await expect(page.getByTestId('rate-confirmation-history').getByText(/^accepted$/i)).toBeVisible()

    const acceptance = await db.query.rateConfirmationAcceptances.findFirst({
      where: eq(schema.rateConfirmationAcceptances.loadId, loadId),
      orderBy: desc(schema.rateConfirmationAcceptances.decidedAt),
    })
    expect(acceptance?.decision).toBe('accepted')
    expect(acceptance?.documentId).toBe(documentRow!.documentId)
    expect(acceptance?.documentVersionId).toBeTruthy()
    expect(acceptance?.documentSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(acceptance?.decidedAt).toBeTruthy()

    const carrierUser = await db.query.users.findFirst({ where: eq(schema.users.email, TENANT_A.carrierUserPermian.email) })
    expect(acceptance?.actorUserId).toBe(carrierUser!.id)
  })

  test('rejecting or requesting changes requires a reason, which is recorded and shown in the decision history', async ({ page }) => {
    const stamp = Date.now()
    await login(page, TENANT_A.admin.email)

    const customerName = `Rate Confirmation Reject Shipper ${stamp}`
    await createCustomer(page, { companyName: customerName })
    const loadId = await createLoad(page, {
      customerName,
      stops: [
        { stopType: 'pickup', facilityName: 'Origin DC', line1: '100 Dock Rd', city: 'Waco', state: 'TX', postalCode: '76701' },
        { stopType: 'delivery', facilityName: 'Destination DC', line1: '200 Depot Ave', city: 'Tyler', state: 'TX', postalCode: '75701' },
      ],
    })
    await assignCarrier(page, loadId, 'Permian Basin Transport LLC')
    await uploadLoadDocument(page, loadId, 'rate_confirmation')

    await login(page, TENANT_A.carrierUserPermian.email)
    await page.goto(`/en/app/loads/${loadId}`)
    await waitForHydration(page)
    await page.getByRole('tab', { name: /documents/i }).click()

    // Reject and "Request changes" are both disabled until a reason is typed.
    const rejectButton = page.getByRole('button', { name: /^reject$/i })
    const requestChangesButton = page.getByRole('button', { name: /^request changes$/i })
    await expect(rejectButton).toBeDisabled()
    await expect(requestChangesButton).toBeDisabled()

    const reasonText = 'Rate does not match the agreed linehaul amount — please revise and resend.'
    await page.locator('#rate-conf-reason').fill(reasonText)
    await expect(rejectButton).toBeEnabled()
    await rejectButton.click()
    await expectToast(page, /^rejected$/i)

    // Scoped to the decision-history entry itself, not a bare `getByText` —
    // the toast (role="status", "Rejected") and the history entry's own
    // "Rejected" label can both still be in the DOM at this point (the
    // toast auto-dismisses on a timer, not synchronously with the request
    // resolving), so an unscoped match is a strict-mode violation whenever
    // the toast hasn't faded yet.
    const historyEntry = page.locator('li').filter({ hasText: reasonText })
    await expect(historyEntry.getByText(/^rejected$/i)).toBeVisible()
    await expect(historyEntry).toBeVisible()

    const acceptance = await db.query.rateConfirmationAcceptances.findFirst({
      where: eq(schema.rateConfirmationAcceptances.loadId, loadId),
      orderBy: desc(schema.rateConfirmationAcceptances.decidedAt),
    })
    expect(acceptance?.decision).toBe('rejected')
    expect(acceptance?.decisionReason).toBe(reasonText)
  })
})
