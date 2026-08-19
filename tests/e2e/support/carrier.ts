import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { waitForHydration } from './wait'
import { expectToast } from './toast'
import { uploadFixture, type FixtureFile } from './upload'

let carrierDotSerial = 0

/**
 * A fresh 8-digit DOT, prefixed `29` (well outside the `100000x` range the
 * FMCSA mock fixtures and both tenants' seeded carriers use) so it never
 * collides with seed data. Carrier creation genuinely refuses a duplicate
 * DOT (`errors.duplicateDot`, `code: 'conflict'` — no override, unlike
 * customers).
 *
 * Two things must both be true for a generator here to be safe: (1) two
 * calls close together in time must not produce the same value, and (2) it
 * must stay unique even across a Playwright *worker restart* — Playwright
 * discards and respawns the worker process after a failing test so a
 * broken page/context can't leak into the next test, which silently resets
 * any plain in-process module state (a monotonic counter starting back at
 * 0 was tried and broke exactly this way: a later test's carrier collided
 * with an earlier, already-committed one from a worker that had since been
 * recycled). `Date.now()` truncated to its *leading* 8 digits (the
 * original approach, before that) failed (1) instead — epoch milliseconds
 * only roll their leading 6 digits over roughly every 11.5 days, so calls
 * moments apart got the same value. Keying off the *trailing* digits of
 * `Date.now()`, which change every millisecond, satisfies (1); layering an
 * in-process counter on top only helps within a single still-alive worker
 * and costs nothing, so it stays as a tiebreaker for calls landing in the
 * same millisecond — but wall-clock time, not the counter, is what
 * survives a worker restart.
 */
function nextTestDot(): string {
  carrierDotSerial += 1
  const millis = Date.now() % 1_000_000
  const suffix = (millis + carrierDotSerial) % 1_000_000
  return `29${String(suffix).padStart(6, '0')}`
}

/**
 * Creates a new carrier through the real `/app/carriers/new` form and
 * returns its id (parsed off the post-create redirect URL). Shared by every
 * flow that needs a fresh, non-seeded carrier to onboard end to end.
 */
export async function createCarrier(
  page: Page,
  opts: { legalName: string; email: string; usesFactoring?: boolean; dotNumber?: string },
): Promise<string> {
  await page.goto('/en/app/carriers/new')
  await waitForHydration(page)
  await page.locator('input[name="legalName"]').fill(opts.legalName)
  await page.locator('input[name="dotNumber"]').fill(opts.dotNumber ?? nextTestDot())
  await page.locator('input[name="contactFirstName"]').fill('Casey')
  await page.locator('input[name="contactLastName"]').fill('Nguyen')
  await page.locator('input[name="email"]').fill(opts.email)
  await page.locator('input[name="phone"]').fill('5125550199')
  await page.locator('input[name="ein"]').fill(String(Date.now()).slice(-9))
  if (opts.usesFactoring) {
    await page.getByRole('checkbox', { name: /uses a factoring company/i }).click()
  }
  const localeSelect = page.getByRole('combobox').first()
  await localeSelect.click()
  await page.getByRole('option').first().click()
  await page.getByRole('button', { name: /save|create|submit/i }).last().click()
  await expect(page).toHaveURL(/\/app\/carriers\/[0-9a-f-]+/, { timeout: 15_000 })
  return page.url().match(/carriers\/([0-9a-f-]+)/)![1]!
}

const DOCUMENT_TYPE_LABEL: Record<string, RegExp> = {
  certificate_of_authority: /^certificate of authority$/i,
  certificate_of_insurance: /certificate of insurance/i,
  w9: /form w-9/i,
  notice_of_assignment: /notice of assignment/i,
  change_of_payee: /change of payee/i,
}

/** Uploads one document of `type` onto the currently-open carrier detail page's Documents tab. */
export async function uploadCarrierDocument(
  page: Page,
  type: keyof typeof DOCUMENT_TYPE_LABEL,
  fixture: FixtureFile = 'sample.pdf',
): Promise<void> {
  await page.getByRole('tab', { name: /documents/i }).click()
  await page.getByRole('button', { name: /upload document/i }).first().click()
  await page.locator('#document-upload-type').click()
  await page.getByRole('option', { name: DOCUMENT_TYPE_LABEL[type] }).click()
  await uploadFixture(page.locator('#document-upload-file'), fixture)
  await page.getByRole('button', { name: /^upload$/i }).click()
  await expectToast(page, /uploaded/i)
}

/** Uploads all three base onboarding documents (Certificate of Authority, COI, W-9). */
export async function uploadBaseRequiredDocuments(page: Page): Promise<void> {
  await uploadCarrierDocument(page, 'certificate_of_authority')
  await uploadCarrierDocument(page, 'certificate_of_insurance')
  await uploadCarrierDocument(page, 'w9')
}

// Unanchored variants of DOCUMENT_TYPE_LABEL, for matching a document row's
// concatenated title+subtitle+status text (`hasText`) rather than a single
// element's exact text.
const DOCUMENT_ROW_LABEL: Record<string, RegExp> = {
  certificate_of_authority: /certificate of authority/i,
  certificate_of_insurance: /certificate of insurance/i,
  w9: /form w-9/i,
  notice_of_assignment: /notice of assignment/i,
  change_of_payee: /change of payee/i,
}

/**
 * Approves the (already-uploaded) document of `type` on the currently-open
 * carrier detail page's Documents tab — expands its review panel and clicks
 * Approve. `carrierGate` (`compliance/gates.ts`) requires every required
 * document's `reviewStatus` to be `'approved'`, not merely present, before
 * onboarding can be approved.
 */
export async function approveCarrierDocument(page: Page, type: keyof typeof DOCUMENT_ROW_LABEL): Promise<void> {
  await page.getByRole('tab', { name: /documents/i }).click()
  const row = page.locator('li').filter({ hasText: DOCUMENT_ROW_LABEL[type] })
  await row.getByRole('button', { name: /^review document$/i }).click()
  await row.getByRole('button', { name: /^approve$/i }).click()
  await expectToast(page, /^approve$/i)
}

/** Approves all three base onboarding documents (Certificate of Authority, COI, W-9). */
export async function approveBaseRequiredDocuments(page: Page): Promise<void> {
  await approveCarrierDocument(page, 'certificate_of_authority')
  await approveCarrierDocument(page, 'certificate_of_insurance')
  await approveCarrierDocument(page, 'w9')
}
