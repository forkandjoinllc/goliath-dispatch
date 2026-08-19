import { closeDb } from './db'

/**
 * Playwright `globalTeardown` — closes the direct Postgres connection pool
 * `support/db.ts` opened for assertions/token-reading, so the process can
 * exit cleanly instead of hanging on an open TCP socket. The `goliath_e2e`
 * database itself is intentionally left in place (inspectable after a
 * failed run) — the next run's `global-setup` resets it before seeding.
 */
export default async function globalTeardown(): Promise<void> {
  await closeDb()
}
