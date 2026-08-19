import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { expectToast } from './toast'
import { createCarrier, uploadBaseRequiredDocuments, approveCarrierDocument } from './carrier'
import { createTruck, uploadAllRequiredEquipmentPhotos, nextTestVin } from './equipment'
import { buildCoiPdfWithVins } from './coi'

export interface CompliantFleet {
  carrierId: string
  carrierName: string
  truckIds: string[]
  truckUnitNumbers: string[]
}

/**
 * Builds a brand-new carrier all the way to onboarding approval (base
 * documents + an FMCSA override, mirroring
 * `05-onboarding-corrections-and-approval.spec.ts`) and then `truckCount`
 * genuinely `active`, COI/VIN-verified trucks for it (mirroring flows 7 and
 * 8's own recipes) — everything `carrierGate`/`equipmentGate` actually
 * require, met for real through the UI.
 *
 * Flow 10's own spec originally tried to reuse the seeded "Summit Heavy
 * Haul LLC" carrier as an already-compliant fixture, on the assumption that
 * an `approved_active` seeded carrier with an `active` fleet is
 * assignment-ready. It isn't reliably: the demo seed also attaches
 * unrelated realistic document history to some seeded carriers (e.g. a
 * pending re-signature notice of assignment) that `carrierGate` correctly
 * treats as blocking, since `loadCarrierGateInput` matches each required
 * document type against the *most recently created* row of that type, not
 * necessarily the approved one. Building a fresh, single-purpose carrier
 * here avoids depending on incidental seed-data shape.
 */
export async function createCompliantCarrierWithTrucks(
  page: Page,
  opts: { carrierName: string; email: string; truckCount: number },
): Promise<CompliantFleet> {
  const carrierId = await createCarrier(page, { legalName: opts.carrierName, email: opts.email })
  await uploadBaseRequiredDocuments(page)
  await approveCarrierDocument(page, 'certificate_of_authority')
  await approveCarrierDocument(page, 'w9')

  // The COI `uploadBaseRequiredDocuments` attached is a content-free
  // placeholder — approve one that actually carries every truck's VIN
  // instead, so equipment verification (below) has something real to match
  // against.
  const vins = Array.from({ length: opts.truckCount }, () => nextTestVin())
  await page.getByRole('tab', { name: /documents/i }).click()
  await page.getByRole('button', { name: /upload document/i }).first().click()
  await page.locator('#document-upload-type').click()
  await page.getByRole('option', { name: /certificate of insurance/i }).click()
  const coiBuffer = await buildCoiPdfWithVins(vins)
  await page
    .locator('#document-upload-file')
    .setInputFiles({ name: 'coi-fleet.pdf', mimeType: 'application/pdf', buffer: coiBuffer })
  await page.getByRole('button', { name: /^upload$/i }).click()
  await expectToast(page, /uploaded/i)
  // Two "Certificate of insurance" rows exist now (this one plus the
  // placeholder `uploadBaseRequiredDocuments` already attached) — the list
  // is newest-first (`listDocumentsForOwner`), so `.first()` is this one.
  const coiRow = page.locator('li').filter({ hasText: /certificate of insurance/i }).first()
  await coiRow.getByRole('button', { name: /^review document$/i }).click()
  await coiRow.getByRole('button', { name: /^approve$/i }).click()
  await expectToast(page, /^approve$/i)

  // A fresh, non-fixture DOT (`createCarrier`'s default) has no FMCSA
  // record at all — the mock adapter returns `not_found`, which the app
  // normalizes to `fmcsaStatus: 'failed'`, the same override-eligible state
  // a mismatch produces. The Verification tab only ever shows the generic
  // `carrier.fmcsa.resultFailed` alert ("FMCSA verification failed.") for
  // this state — the specific `fmcsaNotFound` reason text only renders in
  // the separate Compliance tab's blocking-reasons list
  // (`carrier-compliance-panel.tsx`), not inline here.
  await page.getByRole('tab', { name: /verification/i }).click()
  await page.getByRole('button', { name: /run fmcsa verification/i }).click()
  await expect(page.getByText(/fmcsa verification failed/i)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /^override fmcsa verification$/i }).click()
  await page
    .getByRole('dialog')
    .getByRole('textbox')
    .fill('Verified carrier authority directly by phone for this test fixture; not in the FMCSA mock fixture set.')
  await page.getByRole('dialog').getByRole('button', { name: /^override verification$/i }).click()
  await expectToast(page, /override verification/i)

  await page.getByRole('tab', { name: /onboarding/i }).click()
  await page.getByRole('button', { name: /submit for review/i }).click()
  await expectToast(page, /submit for review/i)
  await page.getByRole('button', { name: /^start review$/i }).click()
  await expectToast(page, /start review/i)
  await page.getByRole('button', { name: /^approve$/i }).click()
  await expectToast(page, /^approve$/i)

  const truckIds: string[] = []
  const truckUnitNumbers: string[] = []
  for (let i = 0; i < opts.truckCount; i += 1) {
    const unitNumber = `TRK-CF-${Date.now()}-${i}`
    const truckId = await createTruck(page, { unitNumber, vin: vins[i]!, carrierName: opts.carrierName })
    await uploadAllRequiredEquipmentPhotos(page)
    await page.getByRole('button', { name: /^mark active$/i }).click()
    await expectToast(page, /^mark active$/i)
    truckIds.push(truckId)
    truckUnitNumbers.push(unitNumber)
  }

  return { carrierId, carrierName: opts.carrierName, truckIds, truckUnitNumbers }
}
