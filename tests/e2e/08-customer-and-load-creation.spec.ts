import { test, expect } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { createCustomer } from './support/customer'
import { createLoad } from './support/loads'
import { expectToast } from './support/toast'
import { db, eq, schema } from './support/db'

/**
 * Flow 9 — Dispatcher creates a customer and a multi-stop load: duplicate
 * customer detection, a load with more than one delivery stop, and
 * appointment windows on those stops.
 */
test.describe('Dispatcher creates customer and load', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TENANT_A.dispatcherFullBook.email)
  })

  test('creates a customer and a multi-stop load with appointment windows', async ({ page }) => {
    const stamp = Date.now()
    const companyName = `Cascade Freight Partners ${stamp}`

    const customerId = await createCustomer(page, {
      companyName,
      phone: '5125559001',
      email: `ap.${stamp}@cascadefreight.example`,
    })
    const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, customerId) })
    expect(customer?.companyName).toBe(companyName)

    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    const pickupWindowStart = new Date(now + 3 * dayMs)
    const pickupWindowEnd = new Date(now + 3 * dayMs + 2 * 60 * 60 * 1000)
    const finalDeliveryWindowStart = new Date(now + 5 * dayMs)

    // A milk-run load: one pickup, one interim delivery, one final delivery —
    // exercises both "more than one stop" and "more than one delivery" at
    // once, plus a real appointment window on the pickup and an exact
    // appointment on the final delivery.
    const loadId = await createLoad(page, {
      customerName: companyName,
      customerReference: `PO-${stamp}`,
      commodity: 'Palletized dry goods',
      stops: [
        {
          stopType: 'pickup',
          facilityName: 'Cascade DC 4',
          line1: '900 Freight Way',
          city: 'Fort Worth',
          state: 'TX',
          postalCode: '76102',
          appointmentType: 'window',
          windowStart: pickupWindowStart,
          windowEnd: pickupWindowEnd,
        },
        {
          stopType: 'delivery',
          facilityName: 'Midway Cross-Dock',
          line1: '210 Interchange Blvd',
          city: 'Shreveport',
          state: 'LA',
          postalCode: '71101',
          appointmentType: 'fcfs',
        },
        {
          stopType: 'delivery',
          facilityName: 'Cascade Retail 12',
          line1: '55 Commerce St',
          city: 'Jackson',
          state: 'MS',
          postalCode: '39201',
          appointmentType: 'exact',
          windowStart: finalDeliveryWindowStart,
        },
      ],
    })

    const load = await db.query.loads.findFirst({ where: eq(schema.loads.id, loadId) })
    expect(load?.customerId).toBe(customerId)
    expect(load?.customerReference).toBe(`PO-${stamp}`)
    expect(load?.status).toBe('draft')

    const stops = await db.query.loadStops.findMany({
      where: eq(schema.loadStops.loadId, loadId),
      orderBy: (t, { asc }) => asc(t.sequence),
    })
    expect(stops).toHaveLength(3)
    expect(stops.filter((s) => s.stopType === 'pickup')).toHaveLength(1)
    expect(stops.filter((s) => s.stopType === 'delivery')).toHaveLength(2)

    const pickupStop = stops.find((s) => s.stopType === 'pickup')!
    expect(pickupStop.facilityName).toBe('Cascade DC 4')
    expect(pickupStop.appointmentType).toBe('window')
    expect(pickupStop.windowStart).toBeTruthy()
    expect(pickupStop.windowEnd).toBeTruthy()
    expect(new Date(pickupStop.windowEnd!).getTime()).toBeGreaterThan(new Date(pickupStop.windowStart!).getTime())

    const finalDelivery = stops.find((s) => s.facilityName === 'Cascade Retail 12')!
    expect(finalDelivery.appointmentType).toBe('exact')
    expect(finalDelivery.windowStart).toBeTruthy()

    // The load detail page reflects the same stop count and reference.
    await page.goto(`/en/app/loads/${loadId}`)
    await waitForHydration(page)
    await expect(page.getByText(`PO-${stamp}`)).toBeVisible()
    await expect(page.getByText('Cascade DC 4')).toBeVisible()
    await expect(page.getByText('Cascade Retail 12')).toBeVisible()
  })

  test('a second customer sharing a DOT number is flagged as a duplicate; only Admin can override', async ({ page }) => {
    const stamp = Date.now()
    const sharedDot = `${stamp}`.slice(-8)
    const firstName = `Blue Ridge Carriers ${stamp}`
    const secondName = `Blue Ridge Logistics Group ${stamp}`

    const firstId = await createCustomer(page, { companyName: firstName, dotNumber: sharedDot })

    await page.goto('/en/app/customers/new')
    await waitForHydration(page)
    await page.locator('input[name="companyName"]').fill(secondName)
    await page.locator('input[name="dotNumber"]').fill(sharedDot)
    await page.getByRole('button', { name: /^create customer$/i }).click()

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText(/this looks like a company you already work with/i)).toBeVisible()
    await expect(page.getByText(/same dot number/i)).toBeVisible()
    await expect(page.getByText(/exact match/i)).toBeVisible()

    const proceedButton = page.getByRole('button', { name: /^create anyway$/i })
    await expect(proceedButton).toBeDisabled()
    await page.getByLabel(/why is this a different company/i).fill('Different, unrelated operating entity confirmed by phone with the shipper.')
    await expect(proceedButton).toBeEnabled()

    // Overriding a duplicate warning is a separate, narrower permission
    // (`customer:duplicate:override`) that only Admin holds — a Dispatcher
    // can see and investigate the warning but cannot force past it.
    await proceedButton.click()
    await expectToast(page, /permission/i)
    await expect(page).toHaveURL('/en/app/customers/new')
    const stillOnlyOne = await db.query.customers.findMany({ where: eq(schema.customers.dotNumber, sharedDot) })
    expect(stillOnlyOne).toHaveLength(1)

    await login(page, TENANT_A.admin.email)
    await page.goto('/en/app/customers/new')
    await waitForHydration(page)
    await page.locator('input[name="companyName"]').fill(secondName)
    await page.locator('input[name="dotNumber"]').fill(sharedDot)
    await page.getByRole('button', { name: /^create customer$/i }).click()

    await expect(page.getByRole('dialog')).toBeVisible()
    const adminProceedButton = page.getByRole('button', { name: /^create anyway$/i })
    await page.getByLabel(/why is this a different company/i).fill('Different, unrelated operating entity confirmed by phone with the shipper.')
    await adminProceedButton.click()

    await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+/, { timeout: 15_000 })
    const secondId = page.url().match(/customers\/([0-9a-f-]+)/)![1]!
    expect(secondId).not.toBe(firstId)

    const both = await db.query.customers.findMany({ where: eq(schema.customers.dotNumber, sharedDot) })
    expect(both.length).toBeGreaterThanOrEqual(2)
    expect(both.some((c) => c.id === firstId)).toBe(true)
    expect(both.some((c) => c.id === secondId)).toBe(true)
  })
})
