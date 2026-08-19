import { test, expect } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { expectToast } from './support/toast'
import { createCarrier, approveCarrierDocument } from './support/carrier'
import { createTruck, nextTestVin } from './support/equipment'
import { buildCoiPdfWithVins } from './support/coi'
import { db, eq, desc, schema } from './support/db'

/**
 * Flow 8 — COI/VIN verification: a truck whose VIN appears on the carrier's
 * approved certificate of insurance passes; one that doesn't is blocked with
 * `vin_not_on_coi`; an Admin override clears the block.
 *
 * Runs entirely as Admin against a fresh carrier so the COI's exact
 * extractable VIN content is fully under this test's control — reusing a
 * seeded carrier's COI would mean asserting against content this spec
 * doesn't own. `buildCoiPdfWithVins` (`support/coi.ts`) drives the same
 * `ocr.mock` fallback path (reading a real PDF's `Subject` metadata) real
 * traffic would.
 */
test('a truck whose VIN is on the approved COI verifies; one that is not is blocked until overridden', async ({
  page,
}) => {
  const stamp = Date.now()
  const carrierName = `Palmetto COI Test ${stamp}`
  const matchingVin = nextTestVin()
  const otherVin = nextTestVin()

  await login(page, TENANT_A.admin.email)
  await createCarrier(page, { legalName: carrierName, email: `coi.test.${stamp}@example.com` })

  // Upload a COI whose only extractable VIN is `matchingVin`.
  await page.getByRole('tab', { name: /documents/i }).click()
  await page.getByRole('button', { name: /upload document/i }).first().click()
  await page.locator('#document-upload-type').click()
  await page.getByRole('option', { name: /certificate of insurance/i }).click()
  const coiBuffer = await buildCoiPdfWithVins([matchingVin])
  await page
    .locator('#document-upload-file')
    .setInputFiles({ name: 'coi-fixture.pdf', mimeType: 'application/pdf', buffer: coiBuffer })
  await page.getByRole('button', { name: /^upload$/i }).click()
  await expectToast(page, /uploaded/i)

  await approveCarrierDocument(page, 'certificate_of_insurance')

  // ── Truck A: VIN matches the COI ──
  const truckAId = await createTruck(page, { unitNumber: `TRK-A-${stamp}`, vin: matchingVin, carrierName })
  const verificationA = await db.query.equipmentVerifications.findFirst({
    where: eq(schema.equipmentVerifications.equipmentId, truckAId),
    orderBy: desc(schema.equipmentVerifications.createdAt),
  })
  expect(verificationA?.matchedVin).toBe(matchingVin)
  expect(verificationA?.blockingReasons).not.toContain('vin_not_on_coi')

  await page.goto(`/en/app/equipment/trucks/${truckAId}`)
  await waitForHydration(page)
  await page.getByRole('tab', { name: /compliance/i }).click()
  await expect(page.getByText(/does not appear on the approved certificate/i)).not.toBeVisible()

  // ── Truck B: VIN is not on the COI ──
  const truckBId = await createTruck(page, { unitNumber: `TRK-B-${stamp}`, vin: otherVin, carrierName })
  const verificationB = await db.query.equipmentVerifications.findFirst({
    where: eq(schema.equipmentVerifications.equipmentId, truckBId),
    orderBy: desc(schema.equipmentVerifications.createdAt),
  })
  expect(verificationB?.matchedVin).toBeNull()
  expect(verificationB?.blockingReasons).toContain('vin_not_on_coi')

  await page.goto(`/en/app/equipment/trucks/${truckBId}`)
  await waitForHydration(page)
  await page.getByRole('tab', { name: /compliance/i }).click()
  await expect(page.getByText(/does not appear on the approved certificate/i)).toBeVisible()

  // ── Admin override clears the block ──
  await page.getByRole('button', { name: /^override$/i }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Confirmed with the carrier — correct VIN, COI will be reissued.')
  await page.getByRole('dialog').getByRole('button', { name: /^confirm$/i }).click()
  await expectToast(page, /^override$/i)

  const verificationBAfterOverride = await db.query.equipmentVerifications.findFirst({
    where: eq(schema.equipmentVerifications.id, verificationB!.id),
  })
  expect(verificationBAfterOverride?.status).toBe('manually_overridden')
  expect(verificationBAfterOverride?.overrideReason).toBeTruthy()
  await expect(page.getByText(/does not appear on the approved certificate/i)).not.toBeVisible()
})
