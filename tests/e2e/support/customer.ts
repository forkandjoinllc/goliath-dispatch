import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { waitForHydration } from './wait'

export interface CreateCustomerOptions {
  companyName: string
  dotNumber?: string
  mcNumber?: string
  phone?: string
  email?: string
}

/**
 * Fills and submits the "New customer" form and returns the resulting
 * customer id. Only `companyName` is required by the form's own schema —
 * everything else here is optional, matching a real dispatcher who may not
 * have every field on hand yet.
 */
export async function createCustomer(page: Page, opts: CreateCustomerOptions): Promise<string> {
  await page.goto('/en/app/customers/new')
  await waitForHydration(page)
  await page.locator('input[name="companyName"]').fill(opts.companyName)
  if (opts.dotNumber) await page.locator('input[name="dotNumber"]').fill(opts.dotNumber)
  if (opts.mcNumber) await page.locator('input[name="mcNumber"]').fill(opts.mcNumber)
  if (opts.phone) await page.locator('input[name="phone"]').fill(opts.phone)
  if (opts.email) await page.locator('input[name="email"]').fill(opts.email)
  await page.getByRole('button', { name: /^create customer$/i }).click()
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+/, { timeout: 15_000 })
  return page.url().match(/customers\/([0-9a-f-]+)/)![1]!
}
