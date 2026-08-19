import { test, expect } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { expectToast } from './support/toast'
import {
  createTruck,
  createTrailer,
  createDriver,
  uploadAllRequiredEquipmentPhotos,
  VIN_DECODES_TO_1989,
} from './support/equipment'
import { fixturePath } from './support/upload'
import { db, eq, schema } from './support/db'

/**
 * Flow 7 — carrier adds equipment and drivers: VIN decode, required media
 * photos, and a driver with license images.
 *
 * The equipment (truck/trailer) tests run as `rosa.delgado@example.com`, the
 * carrier-portal user for Tenant A's already-`approved_active` seeded
 * "Summit Heavy Haul LLC" — the `carrier` role holds `equipment:create`
 * scoped to its own carrier (`src/lib/permissions/catalog.ts`), a real
 * carrier self-service session. The driver test is staff-assisted instead;
 * see its own doc comment for why.
 */
const stamp = Date.now()

test.describe('Carrier adds equipment and drivers', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TENANT_A.carrierUserSummit.email)
  })

  test('adding a truck decodes the VIN and auto-fills year', async ({ page }) => {
    const unitNumber = `TRK-${stamp}`
    const truckId = await createTruck(page, { unitNumber, vin: VIN_DECODES_TO_1989 })

    const truck = await db.query.trucks.findFirst({ where: eq(schema.trucks.id, truckId) })
    expect(truck?.unitNumber).toBe(unitNumber)
    expect(truck?.vinNormalized).toBe(VIN_DECODES_TO_1989)
    expect(truck?.year).toBe(1989)

    // Re-visit the create form directly to assert the decode banner and the
    // auto-filled Year field render for a real blur event, not just that the
    // eventual DB row has the right value (which the offline decoder could
    // also have produced through some other path).
    await page.goto('/en/app/equipment/trucks/new')
    await waitForHydration(page)
    const vinInput = page.locator('input[name="vin"]')
    await vinInput.fill(VIN_DECODES_TO_1989)
    await vinInput.blur()
    await expect(page.getByText(/year and make were filled in from the vin/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('input[name="year"]')).toHaveValue('1989')
  })

  test('a trailer can be added and both units reach 4 required media photos', async ({ page }) => {
    const truckId = await createTruck(page, { unitNumber: `TRK-M-${stamp}` })
    await uploadAllRequiredEquipmentPhotos(page)
    await expect(page.getByText(/all four required angles are captured/i)).toBeVisible()

    const trailerId = await createTrailer(page, { unitNumber: `TRL-${stamp}` })
    await uploadAllRequiredEquipmentPhotos(page)
    await expect(page.getByText(/all four required angles are captured/i)).toBeVisible()

    const truckMedia = await db
      .select()
      .from(schema.equipmentMedia)
      .where(eq(schema.equipmentMedia.equipmentId, truckId))
    expect(truckMedia).toHaveLength(4)
    const trailerMedia = await db
      .select()
      .from(schema.equipmentMedia)
      .where(eq(schema.equipmentMedia.equipmentId, trailerId))
    expect(trailerMedia).toHaveLength(4)

    // `insufficient_media` (`server/compliance/gates.ts`) must have cleared
    // for the truck now that its 4 required angles are all present.
    await page.goto(`/en/app/equipment/trucks/${truckId}`)
    await waitForHydration(page)
    await page.getByRole('tab', { name: /compliance/i }).click()
    await expect(page.getByText(/equipment photos are required/i)).not.toBeVisible()
  })

  // A brand-new driver has no carrier relationship yet, and Carrier-role
  // `driver:read`/`driver:update`/`document:upload` are all scoped to "an
  // active relationship with my own carrier" (`src/lib/permissions/catalog.ts`)
  // — there is no self-service path for a carrier user to view or link a
  // driver they just created (a real, pre-existing gap; see the note in the
  // final report). This step is therefore performed as Admin, exactly like
  // flows 1-6's own staff-assisted onboarding, then handed back to the
  // carrier user to prove the fixed `getDriverResourceContext` scope check
  // (see `server/drivers/queries.ts`) now lets them see their own driver.
  test('staff attaches a driver to the carrier, uploads license images, and the carrier user can then see it', async ({
    page,
  }) => {
    await login(page, TENANT_A.admin.email)
    const driverId = await createDriver(page, { firstName: 'Layla', lastName: `Voss${stamp}` })

    await page.getByRole('tab', { name: /carriers/i }).click()
    const carrierSelect = page.getByRole('tabpanel', { name: /carriers/i }).getByRole('combobox')
    await carrierSelect.click()
    await page.getByRole('option', { name: /summit heavy haul llc/i }).click()
    await page.getByRole('button', { name: /add carrier relationship/i }).click()
    await expectToast(page, /add carrier relationship/i)

    const relationships = await db
      .select()
      .from(schema.driverCarrierRelationships)
      .where(eq(schema.driverCarrierRelationships.driverId, driverId))
    expect(relationships).toHaveLength(1)

    await page.getByRole('tab', { name: /^documents$/i }).click()
    await page.getByRole('button', { name: /upload document/i }).click()
    await page.locator('#document-upload-type').click()
    await page.getByRole('option', { name: /cdl \(front\)/i }).click()
    await page.locator('#document-upload-file').setInputFiles(fixturePath('sample.jpg'))
    await page.getByRole('button', { name: /^upload$/i }).click()
    await expectToast(page, /uploaded/i)

    const documents = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.ownerId, driverId))
    expect(documents.some((d) => d.documentType === 'cdl_front')).toBe(true)

    // The carrier user this driver now belongs to can open the driver's own
    // page (previously an unconditional "Something went wrong" crash for
    // every carrier user viewing every driver — `resource.carrierId` was
    // never populated at all).
    await login(page, TENANT_A.carrierUserSummit.email)
    await page.goto(`/en/app/drivers/${driverId}`)
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: /layla/i })).toBeVisible()
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible()
  })
})
