import { test, expect, type Page } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { createCustomer } from './support/customer'
import { createLoad } from './support/loads'
import { expectToast } from './support/toast'
import { db, eq, and, isNull, desc, schema } from './support/db'

/**
 * Flow 12 — the mock GPS tracking provider: the consent gate blocking
 * session start, `advance()` simulating driver movement, and the public
 * tracking link's privacy-narrowed projection.
 *
 * There is no UI page anywhere in the app that lets a driver actually grant
 * tracking-location consent — `grantTrackingConsentAction`/
 * `revokeTrackingConsentAction` (`server/tracking/actions.ts`) exist and are
 * correctly enforced by `startTrackingSession`, but no component calls
 * either one (confirmed by grepping the whole `src/app` tree). That's a
 * real, standing gap — the tracking-session feature as shipped can never
 * actually be started for any driver through the live product — reported
 * prominently in the suite's final report rather than silently patched
 * around here: building a driver-portal consent page is a real feature
 * addition, not a "small, clearly correct" bug fix this task's scope
 * allows.
 *
 * That gap is exactly why the *first* test below only exercises the refusal
 * path (real, and fully reachable through the UI as shipped), while the
 * *second* test reuses the one tracking session the demo seed itself starts
 * (`seedTrackingForTenantA` in `src/db/seed/tenant-a.ts`, called through the
 * same `startTrackingSession`/`grantTrackingConsent` service functions the
 * app would use if it had a UI for them) to exercise everything downstream
 * of a session actually existing — `advance()` and the public link's
 * privacy narrowing — without a direct DB write standing in for it here.
 */
test.describe('Tracking mock', () => {
  test('starting a session without the driver granting consent is refused', async ({ page }) => {
    const stamp = Date.now()
    await login(page, TENANT_A.admin.email)

    const customerName = `Tracking Consent Shipper ${stamp}`
    await createCustomer(page, { companyName: customerName })
    const loadId = await createLoad(page, {
      customerName,
      stops: [
        { stopType: 'pickup', facilityName: 'Origin DC', line1: '100 Dock Rd', city: 'Waco', state: 'TX', postalCode: '76701' },
        { stopType: 'delivery', facilityName: 'Destination DC', line1: '200 Depot Ave', city: 'Tyler', state: 'TX', postalCode: '75701' },
      ],
    })

    // Any driver with no portal login (the overwhelming majority of seeded
    // drivers) fails the consent check unconditionally, before the service
    // even looks at whether they're assigned to this load — see
    // `startTrackingSession`'s `!driver.userId || !hasActiveTrackingConsent`
    // check, which runs first.
    const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.slug, TENANT_A.slug) })
    const driverWithoutPortalAccount = await db.query.drivers.findFirst({
      where: and(eq(schema.drivers.tenantId, tenant!.id), isNull(schema.drivers.userId)),
    })
    expect(driverWithoutPortalAccount).toBeTruthy()

    await page.goto(`/en/app/tracking/${loadId}`)
    await waitForHydration(page)
    await page.locator('input[name="driverId"]').fill(driverWithoutPortalAccount!.id)
    await page.getByRole('button', { name: /^start tracking$/i }).click()
    await expectToast(page, /location tracking cannot start until the driver has granted tracking consent/i)

    const session = await db.query.trackingSessions.findFirst({ where: eq(schema.trackingSessions.loadId, loadId) })
    expect(session).toBeFalsy()
  })

  test('a consented driver can start a session, advance() moves it, and its public link exposes only the narrow public projection', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now()
    await login(page, TENANT_A.admin.email)

    // The mock tracking provider keeps every session's simulated state in an
    // in-process `Map` (`integrations/tracking/mock-adapter.ts`) — there is
    // no persistence layer for it at all, by design (it exists purely to
    // demo the tracking flow without a real GPS feed). The demo seed's own
    // live session (`seedTrackingForTenantA`) is started by the E2E
    // harness's `globalSetup`, which runs the seed script as a *separate*
    // one-shot child process (`execFileSync(tsx, ['src/db/seed/index.ts'])`,
    // `support/global-setup.ts`) — so that session only ever existed in a
    // process that has since exited, and reaches this test's real running
    // server as `sessionNotFound` (confirmed against the server log) the
    // instant anything tries to advance it. A session this test itself
    // starts against the live server, by contrast, lives in that same
    // server process for the rest of the run, so it works.
    const customerName = `Tracking Session Shipper ${stamp}`
    await createCustomer(page, { companyName: customerName })
    const loadId = await createLoad(page, {
      customerName,
      stops: [
        { stopType: 'pickup', facilityName: 'Origin DC', line1: '100 Dock Rd', city: 'Waco', state: 'TX', postalCode: '76701' },
        { stopType: 'delivery', facilityName: 'Destination DC', line1: '200 Depot Ave', city: 'Tyler', state: 'TX', postalCode: '75701' },
      ],
    })
    const load = await db.query.loads.findFirst({ where: eq(schema.loads.id, loadId) })

    // `carmen.reyes@example.com` (`TENANT_A.driverUser`) is the one seeded
    // driver with both a portal login and consent already granted
    // (`grantTrackingConsent` is a plain DB row, so — unlike the mock
    // provider's session state — it survives the seed's child process
    // exiting just fine).
    const driverUser = await db.query.users.findFirst({ where: eq(schema.users.email, TENANT_A.driverUser.email) })
    const driver = await db.query.drivers.findFirst({ where: eq(schema.drivers.userId, driverUser!.id) })
    expect(driver).toBeTruthy()

    await page.goto(`/en/app/tracking/${loadId}`)
    await waitForHydration(page)
    await page.locator('input[name="driverId"]').fill(driver!.id)
    await page.getByRole('button', { name: /^start tracking$/i }).click()
    await expectToast(page, /^tracking session started\.?$/i)

    const session = await db.query.trackingSessions.findFirst({ where: eq(schema.trackingSessions.loadId, loadId) })
    expect(session).toBeTruthy()
    expect(session?.driverId).toBe(driver!.id)

    // ── advance() ──
    await page.reload()
    await waitForHydration(page)
    await expect(page.getByText(/^provider:/i)).toBeVisible()
    const eventsBefore = await db
      .select()
      .from(schema.trackingEvents)
      .where(eq(schema.trackingEvents.sessionId, session!.id))
    await page.getByRole('button', { name: /^simulate movement$/i }).click()
    await expectToast(page, /advanced the simulated session by/i)
    const eventsAfter = await db
      .select()
      .from(schema.trackingEvents)
      .where(eq(schema.trackingEvents.sessionId, session!.id))
    expect(eventsAfter.length).toBeGreaterThan(eventsBefore.length)

    const refreshedSession = await db.query.trackingSessions.findFirst({ where: eq(schema.trackingSessions.id, session!.id) })
    expect(refreshedSession?.lastEventAt).toBeTruthy()

    // ── public tracking link: create, then open unauthenticated ──
    await page.locator('input[name="label"]').fill('E2E customer share link')
    await page.locator('input[name="recipientEmail"]').fill('shipper.contact@example.com')
    await page.locator('input[name="ttlHours"]').fill('72')
    await page.getByRole('button', { name: /^create tracking link$/i }).click()
    await expect(page.getByText(/this is the only time this link will be shown/i)).toBeVisible({ timeout: 10_000 })
    const rawUrl = await page.locator('code').filter({ hasText: '/track/' }).textContent()
    expect(rawUrl).toBeTruthy()
    const trackPath = new URL(rawUrl!).pathname

    const publicContext = await browser.newContext()
    const publicPage: Page = await publicContext.newPage()
    await publicPage.goto(trackPath)
    await waitForHydration(publicPage)

    // Publicly visible: load number, city/state, status/ETA.
    await expect(publicPage.getByText(load!.loadNumber)).toBeVisible()
    // Never publicly visible: rate/financial figures, carrier DOT/MC, driver
    // name/phone, or a full street address — see
    // `PUBLIC_TRACKING_PROJECTION_KEYS` in `server/tracking/public-links.ts`
    // (also covered by `tests/unit/tracking`'s own privacy test at the
    // projection-builder level; this is the same guarantee checked end to
    // end through a real rendered page).
    const bodyText = (await publicPage.locator('body').innerText()).toLowerCase()
    expect(bodyText).not.toContain('dot ')
    expect(bodyText).not.toContain('100 dock rd')
    expect(bodyText).not.toContain('200 depot ave')
    expect(bodyText).not.toMatch(/\$[\d,]+\.\d{2}/)

    await publicContext.close()

    const linkRow = await db.query.publicTrackingLinks.findFirst({
      where: eq(schema.publicTrackingLinks.loadId, loadId),
      orderBy: desc(schema.publicTrackingLinks.createdAt),
    })
    expect(linkRow?.viewCount).toBeGreaterThan(0)
  })
})
