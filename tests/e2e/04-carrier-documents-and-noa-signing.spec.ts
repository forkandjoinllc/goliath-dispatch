import { test, expect, type Page } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { waitForEmail, extractTokenFromLink, clearOutbox } from './support/outbox'
import { uploadFixture } from './support/upload'
import { expectToast } from './support/toast'
import { db, eq, and, desc, schema } from './support/db'

/**
 * Flow 4 — carrier document upload, then the Notice of Assignment
 * signing ceremony end to end: a drawn signature for the NOA itself, and a
 * typed signature for a second document, so both signature methods are
 * exercised across the suite.
 */

async function createCarrier(page: Page, suffix: string): Promise<string> {
  await page.goto('/en/app/carriers/new')
  await waitForHydration(page)
  await page.locator('input[name="legalName"]').fill(`Rio Grande Freight ${suffix}`)
  await page.locator('input[name="dotNumber"]').fill(`19${suffix}`.slice(0, 8))
  await page.locator('input[name="contactFirstName"]').fill('Nora')
  await page.locator('input[name="contactLastName"]').fill('Vidal')
  await page.locator('input[name="email"]').fill(`carrier.docs.${suffix}@example.com`)
  await page.locator('input[name="phone"]').fill('5125550101')
  await page.locator('input[name="ein"]').fill(String(Date.now()).slice(-9))
  const localeSelect = page.getByRole('combobox').first()
  await localeSelect.click()
  await page.getByRole('option').first().click()
  await page.getByRole('button', { name: /create/i }).last().click()
  await expect(page).toHaveURL(/\/app\/carriers\/[0-9a-f-]+/, { timeout: 15_000 })
  return page.url().match(/carriers\/([0-9a-f-]+)/)![1]!
}

async function sign(
  page: Page,
  token: string,
  opts: { legalName: string; method: 'drawn' | 'typed' },
): Promise<void> {
  await page.goto(`/en/sign/${token}`)
  await waitForHydration(page)

  // Scroll the document body to the end so the "viewed" event fires.
  await page.locator('[aria-live="polite"]').scrollIntoViewIfNeeded()
  const bodyBox = page.locator('div.overflow-y-auto').first()
  await bodyBox.evaluate((el) => el.scrollTo(0, el.scrollHeight))

  await page.locator('#consent-accepted').click()
  await page.locator('#signer-legal-name').fill(opts.legalName)

  if (opts.method === 'typed') {
    await page.getByRole('tab', { name: /^type$/i }).click()
    await page.locator('[role="tabpanel"]').locator('input').first().fill(opts.legalName)
  } else {
    const canvas = page.locator('canvas[role="img"]')
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + 20, box.y + 20)
    await page.mouse.down()
    await page.mouse.move(box.x + 120, box.y + 80, { steps: 10 })
    await page.mouse.move(box.x + 200, box.y + 30, { steps: 10 })
    await page.mouse.up()
  }

  await page.getByRole('button', { name: /sign document/i }).click()
  // Not a loose `getByText` match: the ceremony page's own audit-trail
  // disclaimer already contains the word "signed" ("This records who
  // signed, when, from what device...", `signature.ceremony.legalNotice`),
  // so a text-content check for /signed/i can pass before the submission
  // has actually gone through. The success screen's heading is a distinct,
  // only-post-submission element.
  await expect(page.getByRole('heading', { name: /signed successfully/i })).toBeVisible({ timeout: 15_000 })
}

test.describe('Carrier document upload and Notice of Assignment signing', () => {
  test('carrier uploads a compliance document and completes a drawn NOA signature', async ({ page, request }) => {
    const suffix = `${Date.now()}`.slice(-8)
    await login(page, TENANT_A.admin.email)
    const carrierId = await createCarrier(page, suffix)

    // ── Document upload ──
    await page.getByRole('tab', { name: /documents/i }).click()
    await page.getByRole('button', { name: /upload/i }).first().click()
    const fileInput = page.locator('#document-upload-file')
    await uploadFixture(fileInput, 'sample.pdf')
    await page.getByRole('button', { name: /^upload$/i }).click()
    // The dialog shows "Scanning for malware…" while the upload is in
    // flight; the filename is already visible the moment the file is chosen
    // (before the server action even runs), so waiting on it races the
    // actual upload. The success toast only fires once `uploadDocument` has
    // returned, i.e. once the row genuinely exists.
    await expectToast(page, /uploaded/i)

    const uploadedDocs = await db
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.ownerType, 'carrier'), eq(schema.documents.ownerId, carrierId)))
      .orderBy(desc(schema.documents.createdAt))
      .limit(1)
    expect(uploadedDocs[0]).toBeTruthy()

    // ── Notice of Assignment — drawn signature ──
    await clearOutbox(request)
    const signerEmail = `noa.signer.${suffix}@example.com`
    await page.getByRole('tab', { name: /signatures/i }).click()
    await page.getByRole('button', { name: /send for signature/i }).click()
    await page.locator('#send-signature-template').click()
    await page.getByRole('option', { name: /notice of assignment/i }).click()
    await page.locator('#send-signature-email').fill(signerEmail)
    for (const tokenInput of await page.locator('[id^="send-signature-token-"]').all()) {
      const value = (await tokenInput.inputValue()).trim()
      if (!value) await tokenInput.fill('N/A')
    }
    await page.getByRole('button', { name: /send request/i }).click()
    await expect(page.getByText(/pending|sent/i).first()).toBeVisible({ timeout: 10_000 })

    const message = await waitForEmail(request, signerEmail)
    const token = extractTokenFromLink(message.text || message.html, '/sign/')
    await sign(page, token, { legalName: 'Nora Vidal', method: 'drawn' })

    const requestRow = await db.query.signatureRequests.findFirst({
      where: and(eq(schema.signatureRequests.carrierId, carrierId), eq(schema.signatureRequests.signerEmail, signerEmail)),
    })
    expect(requestRow?.status).toBe('signed')

    const record = await db.query.signatureRecords.findFirst({ where: eq(schema.signatureRecords.requestId, requestRow!.id) })
    expect(record?.method).toBe('drawn')
    expect(record?.signedDocumentId).toBeTruthy()
    expect(record?.auditCertificateDocumentId).toBeTruthy()
    expect(record?.integritySeal).toBeTruthy()
    expect(record?.consentAccepted).toBe(true)
  })

  test('a Change of Payee request can be completed with a typed signature', async ({ page, request }) => {
    const suffix = `${Date.now()}`.slice(-8)
    await login(page, TENANT_A.admin.email)
    const carrierId = await createCarrier(page, `t${suffix}`)

    await clearOutbox(request)
    const signerEmail = `cop.signer.${suffix}@example.com`
    await page.getByRole('tab', { name: /signatures/i }).click()
    await page.getByRole('button', { name: /send for signature/i }).click()
    await page.locator('#send-signature-template').click()
    await page.getByRole('option', { name: /change of payee/i }).click()
    await page.locator('#send-signature-email').fill(signerEmail)
    for (const tokenInput of await page.locator('[id^="send-signature-token-"]').all()) {
      const value = (await tokenInput.inputValue()).trim()
      if (!value) await tokenInput.fill('N/A')
    }
    await page.getByRole('button', { name: /send request/i }).click()
    await expect(page.getByText(/pending|sent/i).first()).toBeVisible({ timeout: 10_000 })

    const message = await waitForEmail(request, signerEmail)
    const token = extractTokenFromLink(message.text || message.html, '/sign/')
    await sign(page, token, { legalName: 'Nora Vidal', method: 'typed' })

    const requestRow = await db.query.signatureRequests.findFirst({
      where: and(eq(schema.signatureRequests.carrierId, carrierId), eq(schema.signatureRequests.signerEmail, signerEmail)),
    })
    expect(requestRow?.status).toBe('signed')
    const record = await db.query.signatureRecords.findFirst({ where: eq(schema.signatureRecords.requestId, requestRow!.id) })
    expect(record?.method).toBe('typed')
  })
})
