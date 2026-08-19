import { test, expect } from '@playwright/test'
import { login, TENANT_B } from './support/auth'
import { waitForHydration } from './support/wait'
import { db, eq, desc, schema } from './support/db'

/**
 * Flow 3 — carrier registration + FMCSA verification, exercising all three
 * documented mock DOT outcomes (`src/integrations/fmcsa/mock-adapter.ts`):
 * a clean match, a reviewable legal-name mismatch, and a blocking
 * no-operating-authority mismatch.
 *
 * Runs as Tenant B's Admin, not Tenant A's: `dotNumber` is unique per
 * tenant, and Tenant A's own seed (`src/db/seed/tenant-a.ts`) already
 * registers carriers against all three of these exact mock DOTs (matching
 * legal names and all) as its own onboarding-pipeline fixtures, so creating
 * another one under Tenant A always fails with `errors.duplicateDot`.
 * Tenant B's seed only claims `FMCSA_MOCK_DOT_NO_AUTHORITY` (for "Del Rio
 * Cross-Border Freight") — the clean and mismatch DOTs are free there, and
 * the no-authority case reuses Del Rio itself rather than fighting over its
 * DOT with a second carrier.
 */

async function createCarrier(
  page: import('@playwright/test').Page,
  opts: { legalName: string; dotNumber: string; suffix: string },
) {
  await page.goto('/en/app/carriers/new')
  await waitForHydration(page)
  await page.locator('input[name="legalName"]').fill(opts.legalName)
  await page.locator('input[name="dotNumber"]').fill(opts.dotNumber)
  await page.locator('input[name="contactFirstName"]').fill('Terry')
  await page.locator('input[name="contactLastName"]').fill('Blake')
  await page.locator('input[name="email"]').fill(`carrier.${opts.suffix}@example.com`)
  await page.locator('input[name="phone"]').fill('5125550100')
  await page.locator('input[name="ein"]').fill(String(Date.now()).slice(-9))
  const localeSelect = page.getByRole('combobox').first()
  await localeSelect.click()
  await page.getByRole('option').first().click()
  await page.getByRole('button', { name: /save|create|submit/i }).last().click()
  await expect(page).toHaveURL(/\/app\/carriers\/[0-9a-f-]+/, { timeout: 15_000 })
  const match = page.url().match(/carriers\/([0-9a-f-]+)/)
  return match![1]!
}

test.describe('Carrier registration and FMCSA verification', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TENANT_B.admin.email)
  })

  test('a clean DOT match verifies without mismatches', async ({ page }) => {
    const carrierId = await createCarrier(page, {
      legalName: 'Summit Heavy Haul LLC',
      dotNumber: '1000001',
      suffix: `clean-${Date.now()}`,
    })
    await page.getByRole('tab', { name: /verification/i }).click()
    await page.getByRole('button', { name: /run fmcsa verification/i }).click()
    await expect(page.getByText(/verified/i).first()).toBeVisible({ timeout: 15_000 })

    const carrier = await db.query.carriers.findFirst({ where: eq(schema.carriers.id, carrierId) })
    expect(carrier?.fmcsaStatus).toBe('verified')
  })

  test('a legal-name mismatch is surfaced but not blocking', async ({ page }) => {
    const carrierId = await createCarrier(page, {
      legalName: 'Apex Heavy Haul LLC',
      dotNumber: '1000002',
      suffix: `mismatch-${Date.now()}`,
    })
    await page.getByRole('tab', { name: /verification/i }).click()
    await page.getByRole('button', { name: /run fmcsa verification/i }).click()
    await expect(page.getByText(/mismatch/i).first()).toBeVisible({ timeout: 15_000 })

    const carrier = await db.query.carriers.findFirst({ where: eq(schema.carriers.id, carrierId) })
    expect(carrier?.fmcsaStatus).toBe('mismatch')

    const verifications = await db
      .select()
      .from(schema.fmcsaVerifications)
      .where(eq(schema.fmcsaVerifications.carrierId, carrierId))
      .orderBy(desc(schema.fmcsaVerifications.checkedAt))
      .limit(1)
    expect(verifications[0]?.mismatches?.some((m) => m.field === 'legalName')).toBe(true)
  })

  test('a no-authority DOT blocks with an operating-authority mismatch', async ({ page }) => {
    // Reuses Tenant B's seeded "Del Rio Cross-Border Freight" rather than
    // registering a new carrier — it already sits on
    // `FMCSA_MOCK_DOT_NO_AUTHORITY`, and that DOT is unique per tenant.
    const delRio = await db.query.carriers.findFirst({
      where: eq(schema.carriers.legalName, 'Del Rio Cross-Border Freight'),
    })
    expect(delRio, 'seeded "Del Rio Cross-Border Freight" carrier should exist').toBeTruthy()
    const carrierId = delRio!.id

    await page.goto(`/en/app/carriers/${carrierId}`)
    await waitForHydration(page)
    await page.getByRole('tab', { name: /verification/i }).click()
    await page.getByRole('button', { name: /run fmcsa verification/i }).click()
    await expect(page.getByText(/mismatch/i).first()).toBeVisible({ timeout: 15_000 })

    const carrier = await db.query.carriers.findFirst({ where: eq(schema.carriers.id, carrierId) })
    expect(carrier?.fmcsaStatus).toBe('mismatch')

    const verifications = await db
      .select()
      .from(schema.fmcsaVerifications)
      .where(eq(schema.fmcsaVerifications.carrierId, carrierId))
      .orderBy(desc(schema.fmcsaVerifications.checkedAt))
      .limit(1)
    expect(verifications[0]?.mismatches?.some((m) => m.field === 'operatingAuthority')).toBe(true)
  })
})
