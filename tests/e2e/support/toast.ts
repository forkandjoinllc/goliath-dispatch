import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Radix's `Toast.Root` renders `role="status"` (a polite live region) — see
 * `src/components/ui/toast.tsx`. Asserting against that role rather than a
 * CSS class keeps this stable across visual changes and works in either
 * locale as long as the caller passes the expected (already-translated) text.
 */
export async function expectToast(page: Page, textOrPattern: string | RegExp): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: textOrPattern }).first()).toBeVisible({ timeout: 10_000 })
}
