import type { Page } from '@playwright/test'

/**
 * Every form in this app submits through React (`react-hook-form` +
 * a server action) rather than a native HTML submit — but the server-rendered
 * HTML is interactive-looking the instant it paints, before React has
 * hydrated onto it. A submit click that lands in that window falls back to
 * a native form submission (method GET, fields as a query string) instead
 * of running the client handler. `networkidle` — no in-flight network
 * activity for 500ms — is a real, observable proxy for "the JS bundle has
 * loaded and executed", used instead of an arbitrary sleep everywhere this
 * suite is about to fill in and submit a form.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
}
