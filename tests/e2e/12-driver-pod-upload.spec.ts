import { test, expect } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { createCustomer } from './support/customer'
import { createLoad, assignCarrier, assignResource, advanceLoadStatus, uploadLoadDocument } from './support/loads'
import { createCompliantCarrierWithTrucks } from './support/compliance'
import { createDriver, makeDriverCompliant, inviteDriverPortalUser } from './support/drivers'
import { expectToast } from './support/toast'
import { waitForEmail, extractTokenFromLink, clearOutbox } from './support/outbox'
import { SEED_PASSWORD } from './support/env'
import { db, eq, and, desc, schema } from './support/db'

/**
 * Flow 13 — a driver uploads a POD: an unassigned driver is refused (the
 * load simply doesn't exist from their point of view), the assigned driver
 * can upload once assigned, Accounting approves it, and the load reaches
 * `pod_received`.
 *
 * The driver-portal account itself is created through the real "Invite to
 * portal" flow on the driver detail page (`DriverPortalAccessPanel`) — the
 * same accept-invitation ceremony flow 2 already exercises for staff users
 * — not seeded, unlike flow 11's carrier-portal login (there is no such UI
 * gap for drivers: `driver.portal.invite` is a real, reachable feature).
 */
test.describe('Driver uploads POD', () => {
  test('an unassigned driver cannot see the load; once assigned they can upload a POD, which Accounting approves through to pod_received', async ({
    page,
    request,
  }) => {
    // A genuinely long, real chain of UI-driven steps — a compliant carrier
    // and driver built from scratch, portal invite/accept, and an 8-step
    // status walk one legal transition at a time — comfortably outruns the
    // default 90s per-test timeout on its own merits (runs ~60-70s once
    // `advanceLoadStatus` can actually find the status dropdown — see the
    // `aria-label` fix on `LoadStatusActions`'s `SelectTrigger`).
    test.setTimeout(150_000)
    const stamp = Date.now()
    await login(page, TENANT_A.admin.email)

    const fleet = await createCompliantCarrierWithTrucks(page, {
      carrierName: `POD Carrier ${stamp}`,
      email: `pod.carrier.${stamp}@example.com`,
      truckCount: 1,
    })

    const driverId = await createDriver(page, { firstName: 'Marcus', lastName: `Delgado${stamp}` })
    await makeDriverCompliant(page, driverId, fleet.carrierName)

    await clearOutbox(request)
    const driverEmail = `marcus.delgado.${stamp}@example.com`
    await inviteDriverPortalUser(page, driverId, driverEmail)
    const invite = await waitForEmail(request, driverEmail)
    const token = extractTokenFromLink(invite.text || invite.html, '/accept-invitation/')
    await page.goto(`/en/accept-invitation/${token}`)
    await waitForHydration(page)
    await page.locator('input[name="firstName"]').fill('Marcus')
    await page.locator('input[name="lastName"]').fill(`Delgado${stamp}`)
    await page.locator('input[name="password"]').fill(SEED_PASSWORD)
    await page.locator('input[name="confirmPassword"]').fill(SEED_PASSWORD)
    const consentCheckboxes = page.getByRole('checkbox')
    await consentCheckboxes.nth(0).click()
    await consentCheckboxes.nth(1).click()
    await page.getByRole('button', { name: /create account/i }).click()
    await expect(page).toHaveURL(/\/app(\/|$|\?)/, { timeout: 20_000 })

    // ── Build the load as Admin ──
    await login(page, TENANT_A.admin.email)
    const customerName = `POD Shipper ${stamp}`
    await createCustomer(page, { companyName: customerName })
    const loadId = await createLoad(page, {
      customerName,
      stops: [
        { stopType: 'pickup', facilityName: 'Origin DC', line1: '100 Dock Rd', city: 'Waco', state: 'TX', postalCode: '76701' },
        { stopType: 'delivery', facilityName: 'Destination DC', line1: '200 Depot Ave', city: 'Tyler', state: 'TX', postalCode: '75701' },
      ],
    })
    await assignCarrier(page, loadId, fleet.carrierName)

    // ── Before being assigned to this load, the driver cannot see it at all
    // — `getLoadResourceContext` only sets `resource.driverId` for a driver
    // actually assigned, so `load:read`'s `own` scope refuses, and (since
    // nothing here catches the resulting `forbidden` AppError) the load
    // detail page's own error boundary renders — the same fails-closed
    // behavior confirmed for cross-tenant access elsewhere in this suite. ──
    await login(page, driverEmail)
    await page.goto(`/en/app/loads/${loadId}`)
    await waitForHydration(page)
    await expect(page.getByText(/something went wrong/i)).toBeVisible()

    // ── Admin assigns the truck and the driver, then walks the load through
    // to `delivered`. ──
    await login(page, TENANT_A.admin.email)
    await assignResource(page, loadId, fleet.truckUnitNumbers[0]!)
    await assignResource(page, loadId, `Marcus Delgado${stamp}`)
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

    // ── The now-assigned driver can see the load and upload a POD. ──
    await login(page, driverEmail)
    await uploadLoadDocument(page, loadId, 'pod')

    const podDoc = await db.query.loadDocuments.findFirst({
      where: and(eq(schema.loadDocuments.loadId, loadId), eq(schema.loadDocuments.documentType, 'pod')),
    })
    expect(podDoc).toBeTruthy()

    // ── Accounting reviews and approves the POD. ──
    await login(page, TENANT_A.accounting.email)
    await page.goto(`/en/app/loads/${loadId}`)
    await waitForHydration(page)
    await page.getByRole('tab', { name: /documents/i }).click()
    const podRow = page.locator('li').filter({ hasText: /proof of delivery/i })
    await podRow.getByRole('button', { name: /^review document$/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^approve$/i }).click()
    await expectToast(page, /^approve$/i)

    // ── Admin moves the load to `pod_received` — only Admin/Dispatcher hold
    // `load:status:update`; Accounting does not. ──
    await login(page, TENANT_A.admin.email)
    await advanceLoadStatus(page, loadId, ['pod_received'])

    const load = await db.query.loads.findFirst({ where: eq(schema.loads.id, loadId) })
    expect(load?.status).toBe('pod_received')
    expect(load?.podReceivedAt).toBeTruthy()

    // `transitionStatus` enqueues `invoice.draft_from_pod` (deduped by load
    // id) the moment a load reaches `pod_received` — the hook flow 14's own
    // spec drains.
    const job = await db.query.jobQueue.findFirst({
      where: eq(schema.jobQueue.dedupeKey, `invoice.draft_from_pod:${loadId}`),
      orderBy: desc(schema.jobQueue.createdAt),
    })
    expect(job).toBeTruthy()
  })
})
