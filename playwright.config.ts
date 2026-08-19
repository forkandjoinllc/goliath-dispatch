import 'dotenv/config'
import { defineConfig, devices } from '@playwright/test'
import { E2E_DATABASE_URL } from './tests/e2e/support/env'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Resets, migrates and seeds the dedicated `goliath_e2e` database exactly
  // once for the whole run (never per test, never per file) — see that
  // file's own doc comment for why this is safe relative to `webServer`'s
  // startup ordering.
  globalSetup: './tests/e2e/support/global-setup.ts',
  globalTeardown: './tests/e2e/support/global-teardown.ts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The dedicated mobile-viewport spec runs only under the `mobile`
      // project below — running it twice would just re-assert the same
      // desktop-shaped behavior the rest of the chromium suite already
      // covers.
      testIgnore: '**/mobile.spec.ts',
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      // Flow 7/13 (carrier equipment+drivers, driver POD upload) at a
      // mobile viewport — see tests/e2e/mobile.spec.ts. The rest of the
      // suite is deliberately not duplicated onto this project: it would
      // roughly double run time for coverage the desktop project already
      // provides.
      testMatch: '**/mobile.spec.ts',
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run start -- --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 600_000,
        env: {
          NODE_ENV: 'production',
          PORT: String(PORT),
          // Points the running app at the dedicated E2E database. Set here
          // (rather than relying on the ambient `.env`) so `goliath_dev` and
          // `goliath_test` can never be touched by an E2E run.
          DATABASE_URL: E2E_DATABASE_URL,
          DATABASE_URL_UNPOOLED: E2E_DATABASE_URL,
        },
      },
})
