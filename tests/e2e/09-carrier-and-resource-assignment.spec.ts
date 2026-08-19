import { test, expect } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { expectToast } from './support/toast'
import { createCustomer } from './support/customer'
import { createLoad } from './support/loads'
import { createTruck } from './support/equipment'
import { createCompliantCarrierWithTrucks } from './support/compliance'
import { db, eq, and, isNull, schema } from './support/db'

/**
 * Flow 10 — Admin assigns a carrier, then trucks, to a load: a
 * non-compliant carrier is refused outright; a non-compliant equipment
 * candidate is shown in the assignment dialog (not hidden) and blocked from
 * selection; and a scheduling conflict names the other load committing the
 * resource.
 *
 * "Highland Steel Carriers" (Tenant A's seeded `draft`-onboarding
 * carrier — never submitted, no documents, no FMCSA check) is used as the
 * guaranteed-non-compliant one. The *compliant* carrier and its trucks are
 * built fresh via `createCompliantCarrierWithTrucks` rather than reused
 * from seed data — see that helper's doc comment for why relying on a
 * seeded "already compliant" carrier turned out not to be safe.
 */
test.describe('Admin assigns carrier and resources', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TENANT_A.admin.email)
  })

  test('a non-compliant carrier is refused; a compliant one is assigned; a non-compliant equipment candidate is shown but blocked', async ({
    page,
  }) => {
    const stamp = Date.now()

    const fleet = await createCompliantCarrierWithTrucks(page, {
      carrierName: `Assignable Carrier ${stamp}`,
      email: `assignable.${stamp}@example.com`,
      truckCount: 1,
    })

    const customerName = `Assignment Test Shipper ${stamp}`
    await createCustomer(page, { companyName: customerName })

    const loadId = await createLoad(page, {
      customerName,
      stops: [
        { stopType: 'pickup', facilityName: 'Origin DC', line1: '100 Dock Rd', city: 'Waco', state: 'TX', postalCode: '76701' },
        { stopType: 'delivery', facilityName: 'Destination DC', line1: '200 Depot Ave', city: 'Tyler', state: 'TX', postalCode: '75701' },
      ],
    })

    await page.goto(`/en/app/loads/${loadId}`)
    await waitForHydration(page)
    await page.getByRole('tab', { name: /assignments/i }).click()

    // ── A draft, never-onboarded carrier is refused outright ──
    const carrierSearch = page.getByPlaceholder('Carrier')
    await carrierSearch.fill('Highland Steel')
    await page.getByRole('option', { name: /highland steel carriers/i }).click()
    await page.getByRole('button', { name: /^assign carrier$/i }).click()
    await expectToast(page, /compliance issue.*blocking/i)

    let load = await db.query.loads.findFirst({ where: eq(schema.loads.id, loadId) })
    expect(load?.carrierId).toBeNull()

    // ── The freshly built, genuinely compliant carrier is assigned successfully ──
    await carrierSearch.fill(fleet.carrierName.slice(0, 12))
    await page.getByRole('option', { name: fleet.carrierName }).click()
    await page.getByRole('button', { name: /^assign carrier$/i }).click()
    await expectToast(page, /^assign carrier$/i)

    load = await db.query.loads.findFirst({ where: eq(schema.loads.id, loadId) })
    expect(load?.carrierId).toBe(fleet.carrierId)

    // ── A freshly created (`pending_verification`) truck is a real
    // candidate — shown in the dialog, not hidden — but disabled/blocked. ──
    const freshUnitNumber = `TRK-FRESH-${stamp}`
    await createTruck(page, { unitNumber: freshUnitNumber, carrierName: fleet.carrierName })

    await page.goto(`/en/app/loads/${loadId}`)
    await waitForHydration(page)
    await page.getByRole('tab', { name: /assignments/i }).click()
    await page.getByRole('button', { name: /^assign resources$/i }).click()

    const dialog = page.getByRole('dialog')
    const freshRow = dialog.locator('li').filter({ hasText: freshUnitNumber })
    await expect(freshRow).toBeVisible({ timeout: 10_000 })
    await expect(freshRow.getByText(/blocked/i)).toBeVisible()
    await expect(freshRow.getByText(/not active/i)).toBeVisible()
    await expect(freshRow.getByRole('checkbox')).toBeDisabled()

    // ── The genuinely compliant candidate can be selected and assigned. ──
    const compliantUnitNumber = fleet.truckUnitNumbers[0]!
    const compliantRow = dialog.locator('li').filter({ hasText: compliantUnitNumber })
    await expect(compliantRow).toBeVisible()
    await expect(compliantRow.getByText(/blocked/i)).not.toBeVisible()
    await compliantRow.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: /^assign selected$/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 10_000 })

    const assignments = await db
      .select()
      .from(schema.loadAssignments)
      .where(and(eq(schema.loadAssignments.loadId, loadId), isNull(schema.loadAssignments.unassignedAt)))
    expect(assignments.some((a) => a.truckId === fleet.truckIds[0])).toBe(true)

    await expect(page.getByText(compliantUnitNumber)).toBeVisible()
  })

  test('a scheduling conflict on an already-committed resource names the other load', async ({ page }) => {
    const stamp = Date.now()

    const fleet = await createCompliantCarrierWithTrucks(page, {
      carrierName: `Scheduling Carrier ${stamp}`,
      email: `scheduling.${stamp}@example.com`,
      truckCount: 1,
    })
    const conflictTruckUnitNumber = fleet.truckUnitNumbers[0]!

    const customerName = `Scheduling Conflict Shipper ${stamp}`
    await createCustomer(page, { companyName: customerName })

    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    const windowStart = new Date(now + 6 * dayMs)
    const windowEnd = new Date(now + 7 * dayMs)

    async function createWindowedLoad(suffix: string): Promise<string> {
      return createLoad(page, {
        customerName,
        stops: [
          {
            stopType: 'pickup',
            facilityName: `Origin ${suffix}`,
            line1: '1 Dock Rd',
            city: 'Waco',
            state: 'TX',
            postalCode: '76701',
            appointmentType: 'window',
            windowStart,
            windowEnd,
          },
          {
            stopType: 'delivery',
            facilityName: `Destination ${suffix}`,
            line1: '2 Depot Ave',
            city: 'Tyler',
            state: 'TX',
            postalCode: '75701',
            appointmentType: 'window',
            windowStart,
            windowEnd,
          },
        ],
      })
    }

    async function assignCarrier(loadId: string): Promise<void> {
      await page.goto(`/en/app/loads/${loadId}`)
      await waitForHydration(page)
      await page.getByRole('tab', { name: /assignments/i }).click()
      await page.getByPlaceholder('Carrier').fill(fleet.carrierName.slice(0, 12))
      await page.getByRole('option', { name: fleet.carrierName }).click()
      await page.getByRole('button', { name: /^assign carrier$/i }).click()
      await expectToast(page, /^assign carrier$/i)
    }

    const loadAId = await createWindowedLoad('A')
    await assignCarrier(loadAId)
    const loadA = await db.query.loads.findFirst({ where: eq(schema.loads.id, loadAId) })

    await page.getByRole('button', { name: /^assign resources$/i }).click()
    const dialogA = page.getByRole('dialog')
    const rowA = dialogA.locator('li').filter({ hasText: conflictTruckUnitNumber })
    await expect(rowA).toBeVisible({ timeout: 10_000 })
    await rowA.getByRole('checkbox').check()
    await dialogA.getByRole('button', { name: /^assign selected$/i }).click()
    await expect(dialogA).not.toBeVisible({ timeout: 10_000 })

    const loadBId = await createWindowedLoad('B')
    await assignCarrier(loadBId)

    await page.getByRole('button', { name: /^assign resources$/i }).click()
    const dialogB = page.getByRole('dialog')
    // Each candidate row is an `<li>` that itself contains a nested `<li>`
    // list of blocking-reason messages — and here the reason message's own
    // text includes the unit number (it's the scheduling-conflict message's
    // `{resource}` label), so a plain `hasText` filter on the unit number
    // matches both the outer row and the inner reason `<li>`. Scope to the
    // outer row specifically via its checkbox descendant.
    const rowB = dialogB.locator('li').filter({ has: page.getByRole('checkbox') }).filter({ hasText: conflictTruckUnitNumber })
    await expect(rowB).toBeVisible({ timeout: 10_000 })
    await expect(rowB.getByText(/blocked/i)).toBeVisible()
    // Names the *unit number* (a real, previously-broken label — see the fix
    // in `resolveResourceLabel`, `server/compliance/service.ts`) and the
    // *other* load's own number, not this one's.
    await expect(
      rowB.getByText(new RegExp(`${conflictTruckUnitNumber}.*already committed to load ${loadA!.loadNumber}`, 'i')),
    ).toBeVisible()
    await expect(rowB.getByRole('checkbox')).toBeDisabled()
  })
})
