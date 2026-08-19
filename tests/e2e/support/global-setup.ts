import { execFileSync } from 'node:child_process'
import path from 'node:path'
import postgres from 'postgres'
import { E2E_ADMIN_DATABASE_URL, E2E_DATABASE_NAME, E2E_DATABASE_URL, REPO_ROOT } from './env'

/**
 * Playwright `globalSetup` — runs once for the whole run, before any test
 * file, and (per Playwright's task ordering) *after* `webServer` has already
 * started and answered a health check, but before any test executes. That
 * ordering is exactly what this needs: the running app process never
 * queries the database until a real request needs it, so it is harmless for
 * the server to be "up" a few seconds before the database it points at
 * (`E2E_DATABASE_URL`, wired into `webServer.env` in `playwright.config.ts`)
 * has been reset/migrated/seeded — by the time the first test navigates a
 * page, this function has already finished.
 *
 * Seeding is expensive (`docs/demo-credentials.md`'s tenant A alone creates
 * 8 carriers, 22 loads, dozens of documents…) — this runs it exactly once
 * per suite invocation, never per test or per file.
 */
export default async function globalSetup(): Promise<void> {
  await ensureDatabaseExists()

  const childEnv = {
    ...process.env,
    // These three scripts each independently guard against running in
    // production (`src/db/reset.ts`, `src/db/seed/index.ts`) — force
    // development semantics for the E2E database regardless of whatever
    // the ambient shell happens to have set.
    NODE_ENV: 'development',
    APP_ENV: 'development',
    ALLOW_DEMO_SEED: 'true',
    DATABASE_URL: E2E_DATABASE_URL,
    DATABASE_URL_UNPOOLED: E2E_DATABASE_URL,
  }

  const tsx = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx')
  const run = (label: string, args: string[], extraEnv: Record<string, string> = {}) => {
    console.log(`[e2e:global-setup] ${label}…`)
    execFileSync(tsx, args, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...childEnv, ...extraEnv } as NodeJS.ProcessEnv,
    })
  }

  // 1. reset — drop and recreate the public/drizzle schemas.
  run('resetting goliath_e2e schema', ['src/db/reset.ts'])
  // 2. migrate — generated Drizzle migrations + drizzle/custom/*.sql triggers.
  run('applying migrations', ['src/db/migrate.ts'])
  // 3. seed — deterministic demo data (fixed PRNG seed + fixed SEED_NOW).
  run('seeding demo data', ['src/db/seed/index.ts'], { NODE_OPTIONS: '--conditions=react-server' })

  console.log('[e2e:global-setup] goliath_e2e is ready.')
}

async function ensureDatabaseExists(): Promise<void> {
  const admin = postgres(E2E_ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`CREATE DATABASE ${E2E_DATABASE_NAME}`)
    console.log(`[e2e:global-setup] created database ${E2E_DATABASE_NAME}`)
  } catch (error) {
    // 42P04 = duplicate_database — already exists, which is the common case
    // on every run after the first. Anything else is a real failure.
    const code = (error as { code?: string }).code
    if (code !== '42P04') throw error
  } finally {
    await admin.end()
  }
}
