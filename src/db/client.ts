import 'server-only'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __goliathSql: ReturnType<typeof postgres> | undefined
}

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

/**
 * Raw connection. Reused across hot reloads in development so the dev server
 * does not exhaust the connection pool.
 */
export const sqlClient =
  global.__goliathSql ??
  postgres(connectionString(), {
    max: process.env.NODE_ENV === 'production' ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    onnotice: () => {},
  })

if (process.env.NODE_ENV !== 'production') global.__goliathSql = sqlClient

/**
 * Unscoped handle.
 *
 * DO NOT import this in feature code. It exists for migrations, seeds and
 * genuinely cross-tenant platform work (Super Admin tooling, webhook intake).
 * Feature code must go through `tenantDb()` in `src/db/tenant-db.ts`, which
 * cannot express a query without a tenant predicate. ESLint enforces this.
 */
export const unsafeDb: PostgresJsDatabase<typeof schema> = drizzle(sqlClient, {
  schema,
  logger: process.env.LOG_LEVEL === 'debug',
})

export type Database = typeof unsafeDb
export { schema }
