import path from 'node:path'

/**
 * Shared constants for the E2E harness — kept dependency-free (no imports
 * from `src/**`) so it can be required from `global-setup`/`global-teardown`
 * before anything else has run.
 */

/** Repo root, resolved relative to this file rather than `process.cwd()` so it is correct no matter where `playwright test` is invoked from. */
export const REPO_ROOT = path.resolve(__dirname, '../../..')

/**
 * A dedicated Postgres database, never `goliath_dev`/`goliath_test`, so a
 * test run can never disturb development data. Overridable for a CI
 * Postgres service with a different host/port.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/goliath_e2e'

/** Same server, used to `CREATE DATABASE` if `goliath_e2e` does not exist yet. */
export const E2E_ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres'

export const E2E_DATABASE_NAME = 'goliath_e2e'

/** Every seeded demo account shares this password (`SEED_DEMO_PASSWORD`). */
export const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'DemoPassw0rd!2026'
