import { test, expect } from '@playwright/test'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { createCarrier, uploadBaseRequiredDocuments, approveBaseRequiredDocuments } from './support/carrier'
import { expectToast } from './support/toast'
import { db, eq, desc, schema } from './support/db'

/**
 * Flows 5 & 6 — Accounting requests corrections on a submitted onboarding,
 * then the carrier resubmits and Admin approves.
 *
 * "Carrier resubmits" is performed here by Admin acting on the carrier's
 * onboarding record directly (`carrier:onboarding:submit` is a tenant-scoped
 * permission Admin already holds) rather than through a separate carrier
 * portal session — this exercises the exact same `submitOnboarding`
 * transition a real carrier-portal resubmission would.
 *
 * Approval is gated by `carrierGate` (`server/compliance/gates.ts`), which
 * requires every required document to be individually approved (not merely
 * uploaded) and `fmcsaStatus` to be `verified` or `manually_overridden` — so
 * this test also drives FMCSA verification and per-document review to
 * completion, not just the state-machine transitions, to reach a real
 * `approved` end state. DOT `1000004` (`FMCSA_MOCK_DOT_NO_INSURANCE`,
 * `src/integrations/fmcsa/mock-adapter.ts`) is used because it is the one
 * mock fixture DOT neither tenant's seed data nor another spec file's own
 * carrier claims — it produces a non-blocking mismatch (no insurance on
 * file) that an Admin/Accounting override clears.
 */
test('Accounting requests corrections, carrier resubmits, Admin approves', async ({ page }) => {
  const stamp = Date.now()

  await login(page, TENANT_A.admin.email)
  const carrierId = await createCarrier(page, {
    legalName: 'Redline Transport Co',
    email: `carrier.corrections.${stamp}@example.com`,
    dotNumber: '1000004',
  })
  await uploadBaseRequiredDocuments(page)
  await approveBaseRequiredDocuments(page)

  // ── FMCSA verification + override (required for approval later) ──
  await page.getByRole('tab', { name: /verification/i }).click()
  await page.getByRole('button', { name: /run fmcsa verification/i }).click()
  await expect(page.getByText(/do not fully match/i)).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: /^override fmcsa verification$/i }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('No-insurance mismatch confirmed acceptable for this test carrier.')
  await page.getByRole('dialog').getByRole('button', { name: /^override verification$/i }).click()
  await expectToast(page, /override verification/i)

  const carrierAfterOverride = await db.query.carriers.findFirst({ where: eq(schema.carriers.id, carrierId) })
  expect(carrierAfterOverride?.fmcsaStatus).toBe('manually_overridden')

  await page.getByRole('tab', { name: /onboarding/i }).click()
  await page.getByRole('button', { name: /submit for review/i }).click()
  // `carrier-onboarding-panel.tsx`'s `runToast()` titles the toast with the
  // action button's own present-tense label (`onboarding.transitions.<key>.action`),
  // not a past-tense "...submitted" sentence.
  await expectToast(page, /submit for review/i)

  await page.getByRole('button', { name: /^start review$/i }).click()
  await expectToast(page, /start review/i)

  const onboardingAfterReview = await db.query.carrierOnboardings.findFirst({
    where: eq(schema.carrierOnboardings.carrierId, carrierId),
  })
  expect(onboardingAfterReview?.status).toBe('under_review')

  // ── Accounting requests corrections ──
  await login(page, TENANT_A.accounting.email)
  await page.goto(`/en/app/carriers/${carrierId}`)
  await waitForHydration(page)
  await page.getByRole('tab', { name: /onboarding/i }).click()
  await page.getByRole('button', { name: /request corrections/i }).click()
  const correctionReason = 'The Certificate of Insurance is missing the general liability endorsement page.'
  await page.getByRole('dialog').getByRole('textbox').fill(correctionReason)
  await page.getByRole('dialog').getByRole('button', { name: /confirm/i }).click()
  await expectToast(page, /request corrections/i)

  const onboardingAfterCorrections = await db.query.carrierOnboardings.findFirst({
    where: eq(schema.carrierOnboardings.carrierId, carrierId),
  })
  expect(onboardingAfterCorrections?.status).toBe('corrections_required')
  expect(onboardingAfterCorrections?.correctionNotes).toBe(correctionReason)

  const rejectionEvent = await db.query.carrierOnboardingEvents.findFirst({
    where: eq(schema.carrierOnboardingEvents.onboardingId, onboardingAfterCorrections!.id),
    orderBy: desc(schema.carrierOnboardingEvents.createdAt),
  })
  expect(rejectionEvent?.toStatus).toBe('corrections_required')
  expect(rejectionEvent?.reason).toBe(correctionReason)

  // The correction note is rendered twice on this panel (a toast/banner
  // plus a persistent "last correction notes" block) — assert presence via
  // `.first()` rather than requiring strict-mode uniqueness.
  await expect(page.getByText(correctionReason).first()).toBeVisible()

  // ── Carrier resubmits ──
  // Accounting doesn't hold `carrier:onboarding:submit` (only request/approve
  // permissions on the review side) — resubmission is performed as Admin,
  // per this test's own doc comment above.
  await login(page, TENANT_A.admin.email)
  await page.goto(`/en/app/carriers/${carrierId}`)
  await waitForHydration(page)
  await page.getByRole('tab', { name: /onboarding/i }).click()
  await page.getByRole('button', { name: /submit for review/i }).click()
  await expectToast(page, /submit for review/i)

  const onboardingAfterResubmit = await db.query.carrierOnboardings.findFirst({
    where: eq(schema.carrierOnboardings.carrierId, carrierId),
  })
  expect(onboardingAfterResubmit?.status).toBe('submitted')

  // ── Admin approves ──
  // `ONBOARDING_TRANSITIONS` (`server/carriers/service.ts`) has no direct
  // submitted -> approved edge — it must pass through under_review again,
  // same as the very first review cycle above.
  await page.getByRole('button', { name: /^start review$/i }).click()
  await expectToast(page, /start review/i)

  await page.getByRole('button', { name: /^approve$/i }).click()
  await expectToast(page, /^approve$/i)

  const finalOnboarding = await db.query.carrierOnboardings.findFirst({
    where: eq(schema.carrierOnboardings.carrierId, carrierId),
  })
  expect(finalOnboarding?.status).toBe('approved')

  const carrier = await db.query.carriers.findFirst({ where: eq(schema.carriers.id, carrierId) })
  expect(carrier?.onboardingStatus).toBe('approved')
})
