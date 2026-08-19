import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** `LOCALE_LABELS` from `src/i18n/config.ts`, matched against the switcher's visible menu item text. */
const LOCALE_LABELS: Record<'en' | 'es', string> = { en: 'English', es: 'Español' }

/**
 * Drives the real `LanguageSwitcher` dropdown (present in both the marketing
 * header and the authenticated app top bar) rather than navigating the URL
 * directly, so a test also exercises the switcher itself.
 */
export async function switchLocale(page: Page, to: 'en' | 'es'): Promise<void> {
  const trigger = page.getByRole('button', { name: /language|idioma/i })
  await trigger.click()
  await page.getByRole('menuitem', { name: LOCALE_LABELS[to] }).click()
  await expect(page).toHaveURL(new RegExp(`/${to}(/|$|\\?)`))
}

/** Raw i18n keys leak into the UI as `namespace.some.dotted.key` — this regex is deliberately conservative (lowercase-only segments) to avoid false positives on legitimate copy like acronyms or version strings. */
export const RAW_I18N_KEY_PATTERN = /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){1,}\b/
