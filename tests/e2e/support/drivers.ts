import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { waitForHydration } from './wait'
import { expectToast } from './toast'

// `createDriver` itself already lives in `support/equipment.ts` (built for
// flow 7) — re-exported here so flow 13's spec can import every driver
// helper it needs from one module.
export { createDriver } from './equipment'

/**
 * Drives a freshly-created driver all the way to `driverGate`-compliant for
 * `carrierName`: a future license/medical-card expiry, an active carrier
 * relationship, and an "Approve" license review — the same four facts
 * `driverGate` (`compliance/gates.ts`) checks (`status: 'active'` is
 * already the row's default on creation, so nothing to set there).
 */
export async function makeDriverCompliant(page: Page, driverId: string, carrierName: string): Promise<void> {
  await page.goto(`/en/app/drivers/${driverId}/edit`)
  await waitForHydration(page)
  await page.locator('input[name="licenseExpiresAt"]').fill('2029-06-01')
  await page.locator('input[name="medicalCardExpiresAt"]').fill('2029-06-01')
  await page.getByRole('button', { name: /^save$/i }).click()
  await expect(page).toHaveURL(/\/app\/drivers\/[0-9a-f-]+$/, { timeout: 15_000 })

  await page.getByRole('tab', { name: /^carriers$/i }).click()
  const carrierSelect = page.getByRole('tabpanel', { name: /carriers/i }).getByRole('combobox')
  await carrierSelect.click()
  await page.getByRole('option', { name: new RegExp(carrierName, 'i') }).click()
  await page.getByRole('button', { name: /add carrier relationship/i }).click()
  await expectToast(page, /add carrier relationship/i)

  await page.getByRole('tab', { name: /^approval$/i }).click()
  await page.getByRole('button', { name: /^approve$/i }).click()
  await expectToast(page, /^approve$/i)
}

/**
 * Invites a portal login for `driverId` and returns the invitation email
 * address (the caller extracts the accept-invitation token from the mock
 * outbox, same as `support/outbox.ts` is already used for staff invites in
 * `02-invite-dispatcher-and-accounting.spec.ts`).
 */
export async function inviteDriverPortalUser(page: Page, driverId: string, email: string): Promise<void> {
  await page.goto(`/en/app/drivers/${driverId}`)
  await waitForHydration(page)
  await page.getByRole('tab', { name: /portal access/i }).click()
  await page.locator('#driver-portal-email').fill(email)
  await page.getByRole('button', { name: /^invite to portal$/i }).click()
  await expectToast(page, /invitation sent|invited/i)
}
