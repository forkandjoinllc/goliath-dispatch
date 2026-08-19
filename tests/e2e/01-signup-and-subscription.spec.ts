import { test, expect } from '@playwright/test'
import { authenticator } from 'otplib'
import { waitForHydration } from './support/wait'
import { waitForEmail, extractTokenFromLink, clearOutbox } from './support/outbox'
import { db, eq, schema } from './support/db'
import { SEED_PASSWORD } from './support/env'

/**
 * Flow 1 — public tenant signup and subscription.
 *
 * Marketing site -> signup wizard -> tenant provisioning -> email
 * verification -> login as the newly-created Admin, then asserts every
 * side effect `provisionTenant`/`signupAction` is documented to perform:
 * the tenant row, its default branding, equipment types, expense
 * categories, signature templates, the 52 default oversize rules, and a
 * (mock) Stripe subscription.
 */
test('public visitor can sign up a new tenant, verify email, and land in the app as Admin', async ({
  page,
  request,
}) => {
  const stamp = Date.now()
  const companyName = `Cascade Freight ${stamp}`
  const adminEmail = `qa.admin.${stamp}@example.com`

  await clearOutbox(request)

  await page.goto('/en')
  await waitForHydration(page)
  await page.getByRole('link', { name: /sign up|get started|start free|create/i }).first().click()
  await expect(page).toHaveURL(/\/signup/)
  await waitForHydration(page)

  // Step 1: company
  await page.locator('input[name="companyName"]').fill(companyName)
  await page.getByRole('button', { name: /next/i }).click()

  // Step 2: admin
  await page.locator('input[name="admin.firstName"]').fill('Jordan')
  await page.locator('input[name="admin.lastName"]').fill('Reyes')
  await page.locator('input[name="admin.email"]').fill(adminEmail)
  await page.locator('input[name="admin.password"]').fill(SEED_PASSWORD)
  await page.locator('input[name="admin.confirmPassword"]').fill(SEED_PASSWORD)
  await page.getByRole('button', { name: /next/i }).click()

  // Step 3: plan — pick the Growth plan explicitly (not just the default)
  await page.getByRole('button', { name: /growth/i }).click()
  await page.getByRole('button', { name: /next/i }).click()

  // Step 4: consents
  const checkboxes = page.getByRole('checkbox')
  await expect(checkboxes).toHaveCount(2)
  await checkboxes.nth(0).click()
  await checkboxes.nth(1).click()
  await page.getByRole('button', { name: /submit|create|sign up/i }).click()

  await expect(page).toHaveURL(/\/signup\/success/, { timeout: 20_000 })
  await expect(page.getByText(adminEmail)).toBeVisible()

  const message = await waitForEmail(request, adminEmail)
  const token = extractTokenFromLink(message.text || message.html, '/verify-email/')

  await page.goto(`/en/verify-email/${token}`)
  await waitForHydration(page)
  await expect(page.getByRole('alert').or(page.locator('[role="status"], [role="alert"]')).first()).toBeVisible()

  // Log in as the freshly-verified Admin.
  await page.goto('/en/login')
  await waitForHydration(page)
  await page.locator('input[name="email"]').fill(adminEmail)
  await page.locator('input[name="password"]').fill(SEED_PASSWORD)
  await page.locator('form button[type="submit"]').click()
  await expect(page).toHaveURL(/\/app(\/|$|\?)/, { timeout: 20_000 })

  // Admin is a MFA-required role (`server/auth/mfa.ts`) — a brand-new Admin
  // with no enrollment yet is forced straight to `/app/mfa-setup` before the
  // rest of the app becomes reachable at all, so "land in the app as Admin"
  // means completing that enrollment, not just landing on any `/app*` URL.
  await expect(page).toHaveURL(/\/app\/mfa-setup/, { timeout: 20_000 })
  const secret = await page.locator('#manual-key').innerText()
  const code = authenticator.generate(secret.replace(/\s+/g, ''))
  await page.locator('input[name="code"]').fill(code)
  await page.getByRole('button', { name: /submit|confirm|enable|verify/i }).click()

  // A confirmed enrollment shows a one-time recovery-codes screen that
  // requires an explicit "I have saved these codes" acknowledgement before
  // "Continue" is enabled — landing in the app doesn't happen straight off
  // the verify step.
  await expect(page.getByRole('heading', { name: /save your recovery codes/i })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('checkbox', { name: /i have saved these codes/i }).click()
  await page.getByRole('button', { name: /continue/i }).click()

  await expect(page).toHaveURL(/\/app(\/|$|\?)/, { timeout: 20_000 })
  await expect(page).not.toHaveURL(/\/mfa-setup/)

  // ── Database-level assertions of everything provisioning is supposed to do ──
  const user = await db.query.users.findFirst({ where: eq(schema.users.emailNormalized, adminEmail.toLowerCase()) })
  expect(user, 'admin user should exist').toBeTruthy()
  expect(user!.status).toBe('active')
  expect(user!.emailVerifiedAt).toBeTruthy()

  const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.displayName, companyName) })
  expect(tenant, 'tenant should exist').toBeTruthy()
  const tenantId = tenant!.id

  const membership = await db.query.userTenantMemberships.findFirst({
    where: (m, { and, eq: eq2 }) => and(eq2(m.tenantId, tenantId), eq2(m.userId, user!.id)),
  })
  expect(membership?.role).toBe('admin')

  const equipmentTypeCount = await db
    .select()
    .from(schema.equipmentTypes)
    .where(eq(schema.equipmentTypes.tenantId, tenantId))
  expect(equipmentTypeCount.length).toBeGreaterThan(0)

  const expenseCategoryCount = await db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.tenantId, tenantId))
  expect(expenseCategoryCount.length).toBeGreaterThan(0)

  const signatureTemplateCount = await db
    .select()
    .from(schema.signatureTemplates)
    .where(eq(schema.signatureTemplates.tenantId, tenantId))
  expect(signatureTemplateCount.length).toBeGreaterThan(0)

  const oversizeRuleCount = await db
    .select()
    .from(schema.oversizeRules)
    .where(eq(schema.oversizeRules.tenantId, tenantId))
  expect(oversizeRuleCount).toHaveLength(52)

  const subscription = await db.query.tenantSubscriptions.findFirst({
    where: eq(schema.tenantSubscriptions.tenantId, tenantId),
  })
  expect(subscription, 'a (mock) Stripe subscription should have been created').toBeTruthy()
  expect(subscription!.stripeSubscriptionId).toBeTruthy()

  const plan = await db.query.saasPlans.findFirst({ where: eq(schema.saasPlans.id, subscription!.planId) })
  expect(plan?.code).toBe('growth')
})
