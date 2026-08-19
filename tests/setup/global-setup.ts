import path from 'node:path'
import { config } from 'dotenv'

/**
 * Shared Vitest setup for every project (`unit`, `integration`, `component`).
 *
 * Loads the repo's `.env` so `serverEnv()` can parse successfully outside a
 * real deployment — `dotenv` never overwrites a variable the shell/CI already
 * set, so this is a pure fallback. Unit tests never open a database
 * connection themselves; anything that imports `src/db/client.ts` still needs
 * `TEST_DATABASE_URL` wired up by the integration project's own
 * `db-setup.ts`.
 */
config({ path: path.resolve(__dirname, '../../.env') })

if (!process.env.NODE_ENV) {
  // `NODE_ENV` is typed read-only by @types/node; Object.defineProperty is the
  // documented escape hatch for the rare case something needs to set it.
  Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', writable: true, enumerable: true })
}
process.env.APP_ENV ??= 'test'
