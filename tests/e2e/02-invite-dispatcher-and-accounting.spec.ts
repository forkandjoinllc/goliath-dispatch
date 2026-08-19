import { test, expect } from '@playwright/test'
import { authenticator } from 'otplib'
import { login, TENANT_A } from './support/auth'
import { waitForHydration } from './support/wait'
import { waitForEmail, extractTokenFromLink, clearOutbox } from './support/outbox'
import { expectToast } from './support/toast'
import { db, eq, schema } from './support/db'
import { SEED_PASSWORD } from './support/env'

/**
 * Flow 2 — Admin invites a Dispatcher and an Accounting user.
 *
 * Covers invitation issuance -> the invite email actually landing in the
 * mock outbox -> acceptance through the real accept-invitation form, and
 * that a freshly-accepted Accounting membership is forced through MFA
 * enrollment before it can reach the app (Dispatcher is not).
 */
test.describe('Admin invites Dispatcher and Accounting users', () => {
  test('invited Dispatcher accepts and reaches the app without an MFA challenge', async ({ page, request }) => {
    const stamp = Date.now()
    const email = `qa.dispatcher.${stamp}@example.com`
    await clearOutbox(request)

    await login(page, TENANT_A.admin.email)
    await page.goto('/en/app/users')
    await waitForHydration(page)

    await page.getByRole('button', { name: /invite/i }).click()
    await page.locator('input[name="firstName"]').fill('Priya')
    await page.locator('input[name="lastName"]').fill('Nolan')
    await page.locator('input[name="email"]').fill(email)
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: /dispatcher/i }).click()
    await page.getByRole('button', { name: /send invitation/i }).click()

    // A pending invitation has no `userTenantMemberships` row yet (only
    // an opaque token — see `issueInvitation` in `server/auth/registration.ts`),
    // so it cannot show up in this list-of-members table until it is
    // accepted; the success toast is the real, immediate signal here.
    await expectToast(page, /invitation sent/i)

    const message = await waitForEmail(request, email)
    const token = extractTokenFromLink(message.text || message.html, '/accept-invitation/')

    await page.goto(`/en/accept-invitation/${token}`)
    await waitForHydration(page)
    await page.locator('input[name="firstName"]').fill('Priya')
    await page.locator('input[name="lastName"]').fill('Nolan')
    await page.locator('input[name="password"]').fill(SEED_PASSWORD)
    await page.locator('input[name="confirmPassword"]').fill(SEED_PASSWORD)
    const checkboxes = page.getByRole('checkbox')
    await checkboxes.nth(0).click()
    await checkboxes.nth(1).click()
    await page.getByRole('button', { name: /create account/i }).click()

    await expect(page).toHaveURL(/\/app(\/|$|\?)/, { timeout: 20_000 })

    const user = await db.query.users.findFirst({ where: eq(schema.users.emailNormalized, email.toLowerCase()) })
    expect(user?.status).toBe('active')
    const membership = await db.query.userTenantMemberships.findFirst({
      where: (m, { and, eq: eq2 }) => and(eq2(m.userId, user!.id)),
    })
    expect(membership?.role).toBe('dispatcher')
  })

  test('invited Accounting user accepts and is forced into MFA enrollment', async ({ page, request }) => {
    const stamp = Date.now()
    const email = `qa.accounting.${stamp}@example.com`
    await clearOutbox(request)

    await login(page, TENANT_A.admin.email)
    await page.goto('/en/app/users')
    await waitForHydration(page)

    await page.getByRole('button', { name: /invite/i }).click()
    await page.locator('input[name="firstName"]').fill('Sam')
    await page.locator('input[name="lastName"]').fill('Okafor')
    await page.locator('input[name="email"]').fill(email)
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: /accounting/i }).click()
    await page.getByRole('button', { name: /send invitation/i }).click()

    // A pending invitation has no `userTenantMemberships` row yet (only
    // an opaque token — see `issueInvitation` in `server/auth/registration.ts`),
    // so it cannot show up in this list-of-members table until it is
    // accepted; the success toast is the real, immediate signal here.
    await expectToast(page, /invitation sent/i)

    const message = await waitForEmail(request, email)
    const token = extractTokenFromLink(message.text || message.html, '/accept-invitation/')

    await page.goto(`/en/accept-invitation/${token}`)
    await waitForHydration(page)
    await page.locator('input[name="firstName"]').fill('Sam')
    await page.locator('input[name="lastName"]').fill('Okafor')
    await page.locator('input[name="password"]').fill(SEED_PASSWORD)
    await page.locator('input[name="confirmPassword"]').fill(SEED_PASSWORD)
    const checkboxes = page.getByRole('checkbox')
    await checkboxes.nth(0).click()
    await checkboxes.nth(1).click()
    await page.getByRole('button', { name: /create account/i }).click()

    // Accounting is in MFA_REQUIRED_ROLES (`src/server/auth/mfa.ts`) — the
    // authenticated app layout redirects an unenrolled member straight to
    // `/app/mfa-setup` before it will render anything else.
    await expect(page).toHaveURL(/\/app\/mfa-setup/, { timeout: 20_000 })

    const secret = await page.locator('#manual-key').innerText()
    const code = authenticator.generate(secret.replace(/\s+/g, ''))
    await page.locator('input[name="code"]').fill(code)
    await page.getByRole('button', { name: /submit|confirm|enable|verify/i }).click()

    // A confirmed enrollment shows a one-time recovery-codes screen that
    // requires an explicit "I have saved these codes" acknowledgement
    // before "Continue" is enabled — see the identical step in
    // `01-signup-and-subscription.spec.ts`.
    await expect(page.getByRole('heading', { name: /save your recovery codes/i })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('checkbox', { name: /i have saved these codes/i }).click()
    await page.getByRole('button', { name: /continue/i }).click()

    await expect(page).toHaveURL(/\/app(\/|$|\?)/, { timeout: 20_000 })
    await expect(page).not.toHaveURL(/\/mfa-setup/)

    const user = await db.query.users.findFirst({ where: eq(schema.users.emailNormalized, email.toLowerCase()) })
    const config = await db.query.mfaConfigurations.findFirst({ where: eq(schema.mfaConfigurations.userId, user!.id) })
    expect(config?.method).toBe('totp')
    expect(config?.confirmedAt).toBeTruthy()

    // Logging back in now must challenge MFA — `login()` navigates straight
    // to `/en/login` itself, discarding whatever session cookie is active.
    await login(page, email)
  })
})
