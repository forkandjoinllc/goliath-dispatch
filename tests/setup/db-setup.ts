import 'dotenv/config'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'

/**
 * Integration test database bootstrap.
 *
 * Runs the generated Drizzle migrations plus the hand-written SQL in
 * `drizzle/custom/` once against `goliath_test`, then truncates every table
 * between tests so each test starts from an empty database. Integration
 * tests share one Postgres instance and run serially (see `pool: 'forks'`,
 * `singleFork: true` in `vitest.config.ts`), so a single migrated connection
 * reused across the whole run is safe and fast.
 *
 * This file deliberately never imports `@/db/client` or `@/db/tenant-db`:
 * those modules read `process.env.DATABASE_URL` at module-evaluation time,
 * and this file's own env override below must win before anything reads it.
 * Vitest fully executes every `setupFiles` entry before loading any test
 * file, so by the time a test file's `import { tenantDb } from '@/db/...'`
 * resolves, the override has already taken effect.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/goliath_test'

process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.DATABASE_URL_UNPOOLED = TEST_DATABASE_URL
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL

const migrationClient = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
const migrationDb = drizzle(migrationClient)

let migrated: Promise<void> | null = null

async function runMigrationsOnce(): Promise<void> {
  migrated ??= (async () => {
    await migrate(migrationDb, { migrationsFolder: './drizzle' })

    const customDir = join(process.cwd(), 'drizzle', 'custom')
    if (existsSync(customDir)) {
      const files = readdirSync(customDir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
      for (const file of files) {
        await migrationClient.unsafe(readFileSync(join(customDir, file), 'utf8'))
      }
    }
  })()
  await migrated
}

let cachedTableNames: string[] | null = null

/** Every real table Drizzle knows about, in whatever order `schema` exports them. */
function allTableNames(): string[] {
  if (cachedTableNames) return cachedTableNames
  const names: string[] = []
  for (const value of Object.values(schema)) {
    if (value instanceof PgTable) {
      names.push(getTableConfig(value).name)
    }
  }
  cachedTableNames = names
  return names
}

/**
 * `TRUNCATE` fires `ON TRUNCATE` triggers, not the `BEFORE DELETE` guards the
 * append-only tables install (`drizzle/custom/0001_audit_immutability.sql`),
 * so a single statement across every table — audit tables included — is safe
 * and leaves each test with a clean slate.
 */
async function truncateAll(): Promise<void> {
  const names = allTableNames()
  if (names.length === 0) return
  const quoted = names.map((name) => `"${name}"`).join(', ')
  await migrationClient.unsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`)
}

beforeAll(async () => {
  await runMigrationsOnce()
  await truncateAll()
}, 120_000)

afterEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await migrationClient.end()
})
