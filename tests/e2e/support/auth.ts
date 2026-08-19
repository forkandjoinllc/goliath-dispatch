import type { BrowserContext, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { authenticator } from 'otplib'
import { SEED_PASSWORD } from './env'
import { getDecryptedMfaSecret } from './db'
import { waitForHydration } from './wait'

export type Locale = 'en' | 'es'

/** Tenant A — Goliath Dispatch Co. (`docs/demo-credentials.md`). */
export const TENANT_A = {
  slug: 'goliath-dispatch-co',
  admin: { email: 'diane.whitfield@example.com' },
  accounting: { email: 'marisol.gutierrez@example.com' }, // MFA-enrolled
  dispatcherFullBook: { email: 'kevin.marsh@example.com' },
  dispatcherRestricted: { email: 'alejandro.duarte@example.com' },
  carrierUserSummit: { email: 'rosa.delgado@example.com' },
  carrierUserPermian: { email: 'gregory.nash@example.com' },
  driverUser: { email: 'carmen.reyes@example.com' },
}

/** Tenant B — Summit Heavy Logistics. */
export const TENANT_B = {
  slug: 'summit-heavy-logistics',
  admin: { email: 'marcus.ilori@example.com' },
  dispatcher: { email: 'elena.cabrera@example.com' },
  accounting: { email: 'trevor.whitmore@example.com' }, // not MFA-enrolled
  carrierUser: { email: 'hector.rivera@example.com' },
  driverUser: { email: 'beto.cantu@example.com' },
}

/**
 * In-process cache of already-authenticated sessions, keyed by
 * `email::locale`. Real logins go through server-side rate limiting
 * (`rateLimitPolicies.loginByEmail`: 8 attempts / 15 minutes per email —
 * `src/lib/rate-limit.ts`), and a handful of seeded accounts (mainly each
 * tenant's Admin) get logged into from many different spec files across a
 * full suite run. `playwright.config.ts` runs this project with a single
 * worker and `fullyParallel: false`, i.e. one Node process for the entire
 * run, which is what makes a plain in-memory `Map` here valid for the whole
 * suite — a fresh `npx playwright test` invocation always starts this
 * module (and the map) empty. Reusing a previously-established session's
 * cookies is exactly what a real user's already-logged-in browser tab would
 * do; it doesn't skip anything meaningfully "under test" (the login *form*
 * and its MFA challenge are exercised for real by every first use of an
 * account, and explicitly by `02-invite-dispatcher-and-accounting.spec.ts`).
 */
type SessionCookies = Awaited<ReturnType<BrowserContext['cookies']>>
const sessionCookieCache = new Map<string, SessionCookies>()

/**
 * Signs in through the real login form, following an MFA challenge with a
 * freshly generated TOTP code when the account requires it (Admin/Accounting
 * with a confirmed enrollment). Locators key off the `name` attribute
 * react-hook-form puts on every field — not label text — so this same
 * helper works unchanged in `es` (see `tests/e2e/bilingual.spec.ts`).
 *
 * Reuses a cached session (see `sessionCookieCache` above) for any account
 * this process has already logged into, unless `forceFreshLogin` is set —
 * pass that when a test specifically needs to exercise the login form/MFA
 * challenge itself for an account that might already be cached.
 */
export async function login(
  page: Page,
  email: string,
  options: { password?: string; locale?: Locale; forceFreshLogin?: boolean } = {},
): Promise<void> {
  const locale = options.locale ?? 'en'
  const password = options.password ?? SEED_PASSWORD
  const cacheKey = `${email.toLowerCase()}::${locale}`

  const cached = options.forceFreshLogin ? undefined : sessionCookieCache.get(cacheKey)
  if (cached) {
    await page.context().addCookies(cached)
    await page.goto(`/${locale}/app`)
    await waitForHydration(page)
    if (/\/app(\/|$|\?)/.test(page.url()) && !/\/mfa-setup/.test(page.url())) {
      return
    }
    // The cached session didn't stick (expired, revoked, etc.) — clear it
    // and fall through to a real login below.
    sessionCookieCache.delete(cacheKey)
  }

  await page.goto(`/${locale}/login`)
  await waitForHydration(page)
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('form button[type="submit"]').click()

  // The redirect from `/login` to either `/login/mfa` or straight into
  // `/app` happens after an in-flight server action resolves — reading
  // `page.url()` right after the click (rather than waiting for one of the
  // two possible destinations) raced that redirect and could observe the
  // stale `/login` URL, silently skipping the MFA branch below for any
  // account that actually needed it.
  await page.waitForURL(/\/login\/mfa|\/app(\/|$|\?)/, { timeout: 20_000 })

  if (/\/login\/mfa/.test(page.url())) {
    const secret = await getDecryptedMfaSecret(email)
    const code = authenticator.generate(secret)
    await page.locator('input[name="code"]').fill(code)
    await page.locator('form button[type="submit"]').click()
  }

  await expect(page).toHaveURL(/\/app(\/|$|\?)/, { timeout: 20_000 })
  // `/app/mfa-setup` also matches the pattern above (it contains `/app/`) —
  // every seeded Admin/Accounting account is enrolled precisely so a normal
  // `login()` never silently lands here instead of the real destination.
  await expect(page).not.toHaveURL(/\/mfa-setup/)

  sessionCookieCache.set(cacheKey, await page.context().cookies())
}
