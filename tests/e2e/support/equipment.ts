import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { computeVinCheckDigit } from '@/server/equipment/vin'
import { waitForHydration } from './wait'
import { fixturePath } from './upload'

/**
 * The check-digit worked example from `server/equipment/vin.ts`'s own unit
 * tests (`tests/unit/equipment/vin.test.ts`) — 17 well-formed characters
 * with a valid check digit and a decodable model year (position 10 'K',
 * position 7 numeric '9' -> the 1980s cycle -> 1989). Its WMI isn't in the
 * app's manufacturer table, so decoding it fills in Year but not Make —
 * enough to exercise the real decode-on-blur codepath deterministically
 * without depending on any particular WMI staying in that table.
 */
export const VIN_DECODES_TO_1989 = '1M8GDM9AXKP042788'

let vinSerial = 0

/**
 * A fresh, check-digit-valid VIN that still decodes to 1989 (same prefix and
 * model-year/plant characters as `VIN_DECODES_TO_1989`, only the trailing
 * sequence-number digits vary) — a VIN is unique per tenant
 * (`server/equipment/service.ts`), so reusing the one fixed constant across
 * more than one created truck/trailer in the same test run trips that
 * constraint. Position 9 (index 8, the check digit itself) carries weight 0
 * in `computeVinCheckDigit`, so the placeholder there doesn't affect the
 * recomputed digit.
 */
export function nextTestVin(): string {
  vinSerial += 1
  const serial = String(vinSerial).padStart(6, '0')
  const withPlaceholderCheckDigit = `1M8GDM9A0KP${serial}`
  const checkDigit = computeVinCheckDigit(withPlaceholderCheckDigit) ?? '0'
  return `1M8GDM9A${checkDigit}KP${serial}`
}

/**
 * Creates a truck for the currently-logged-in actor's own carrier (the
 * `carrierId` select has exactly one option for a carrier-portal user) and
 * returns its id. Fills the VIN and blurs it first so the real offline
 * decoder in `equipment-form.tsx` runs before the rest of the form is
 * filled in — mirrors how a real user tabs through the form.
 */
/**
 * Selects an option from the "Carrier" combobox on the equipment
 * create/edit form. `getByLabel` requires a labelable-element association
 * Radix's custom `role="combobox"` trigger doesn't reliably provide; the
 * trigger's own *accessible name* (computed from the same `<label for>`,
 * aria-hidden required-asterisk correctly excluded) is "Carrier", so this
 * queries by role instead. Staff sees every carrier in the tenant and must
 * pick by name; a carrier-portal user's own carrier is the only option.
 */
async function selectCarrierOption(page: Page, carrierName?: string): Promise<void> {
  const carrierSelect = page.getByRole('combobox', { name: 'Carrier', exact: true })
  await carrierSelect.click()
  if (carrierName) {
    await page.getByRole('option', { name: carrierName, exact: true }).click()
  } else {
    await page.getByRole('option').first().click()
  }
}

export async function createTruck(
  page: Page,
  opts: { unitNumber: string; vin?: string; carrierName?: string },
): Promise<string> {
  await page.goto('/en/app/equipment/trucks/new')
  await waitForHydration(page)
  await page.locator('input[name="unitNumber"]').fill(opts.unitNumber)
  const vinInput = page.locator('input[name="vin"]')
  await vinInput.fill(opts.vin ?? nextTestVin())
  await vinInput.blur()

  await selectCarrierOption(page, opts.carrierName)

  await page.getByRole('button', { name: /^save$/i }).click()
  await expect(page).toHaveURL(/\/app\/equipment\/trucks\/[0-9a-f-]+/, { timeout: 15_000 })
  return page.url().match(/trucks\/([0-9a-f-]+)/)![1]!
}

/** Creates a trailer the same way as `createTruck` — every trailer-only field is optional. */
export async function createTrailer(
  page: Page,
  opts: { unitNumber: string; vin?: string; carrierName?: string },
): Promise<string> {
  await page.goto('/en/app/equipment/trailers/new')
  await waitForHydration(page)
  await page.locator('input[name="unitNumber"]').fill(opts.unitNumber)
  await page.locator('input[name="vin"]').fill(opts.vin ?? nextTestVin())

  await selectCarrierOption(page, opts.carrierName)

  await page.getByRole('button', { name: /^save$/i }).click()
  await expect(page).toHaveURL(/\/app\/equipment\/trailers\/[0-9a-f-]+/, { timeout: 15_000 })
  return page.url().match(/trailers\/([0-9a-f-]+)/)![1]!
}

const REQUIRED_MEDIA_ANGLES = ['front', 'rear', 'driver_side', 'passenger_side'] as const

/**
 * Uploads one photo for `angle` on the currently-open truck/trailer detail
 * page's Media tab. The file input is visually hidden (a toolbar button
 * proxies the click) but still a real `<input type="file">` Playwright can
 * set files on directly.
 */
export async function uploadEquipmentPhoto(page: Page, angle: (typeof REQUIRED_MEDIA_ANGLES)[number]): Promise<void> {
  await page.getByRole('tab', { name: /^media$/i }).click()
  const angleSelect = page.getByRole('combobox')
  await angleSelect.click()
  await page.getByRole('option', { name: new RegExp(`^${angle.replace('_', ' ')}`, 'i') }).click()
  await page.locator('input[type="file"][accept*="image"]').setInputFiles(fixturePath('sample.jpg'))
  await expect(page.getByRole('status').filter({ hasText: /upload photo/i }).first()).toBeVisible({ timeout: 10_000 })
}

/** Uploads all four required angles so `insufficient_media` clears on the compliance gate. */
export async function uploadAllRequiredEquipmentPhotos(page: Page): Promise<void> {
  for (const angle of REQUIRED_MEDIA_ANGLES) {
    await uploadEquipmentPhoto(page, angle)
  }
}

/** Creates a driver (not yet attached to any carrier) and returns its id. */
export async function createDriver(page: Page, opts: { firstName: string; lastName: string }): Promise<string> {
  await page.goto('/en/app/drivers/new')
  await waitForHydration(page)
  await page.locator('input[name="firstName"]').fill(opts.firstName)
  await page.locator('input[name="lastName"]').fill(opts.lastName)
  await page.getByRole('button', { name: /^save$/i }).click()
  await expect(page).toHaveURL(/\/app\/drivers\/[0-9a-f-]+/, { timeout: 15_000 })
  return page.url().match(/drivers\/([0-9a-f-]+)/)![1]!
}
