import 'server-only'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __goliathSql: Sql | undefined
  // eslint-disable-next-line no-var
  var __goliathDb: PostgresJsDatabase<typeof schema> | undefined
}

/**
 * Connection is established lazily, on first query — never at import time.
 *
 * This matters for more than tidiness. `next build` imports every route module
 * to collect page data, so a connection created at module scope would make the
 * build itself require DATABASE_URL, and a deploy would fail before a single
 * request was served. Nothing queries the database at build time, so nothing
 * should demand a database at build time.
 *
 * The failure, when the variable really is missing, now happens at the first
 * query with the same clear message — at the moment it is actually actionable.
 */
function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env for local development, or set it in your hosting provider’s environment variables.',
    )
  }
  return url
}

function createSqlClient(): Sql {
  return postgres(connectionString(), {
    max: process.env.NODE_ENV === 'production' ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    onnotice: () => {},
  })
}

/** Memoized across hot reloads so the dev server does not exhaust the pool. */
function resolveSqlClient(): Sql {
  if (process.env.NODE_ENV !== 'production') {
    global.__goliathSql ??= createSqlClient()
    return global.__goliathSql
  }
  return (globalThis as { __goliathSqlProd?: Sql }).__goliathSqlProd ??= createSqlClient()
}

function resolveDb(): PostgresJsDatabase<typeof schema> {
  if (process.env.NODE_ENV !== 'production') {
    global.__goliathDb ??= drizzle(resolveSqlClient(), {
      schema,
      logger: process.env.LOG_LEVEL === 'debug',
    })
    return global.__goliathDb
  }
  return ((globalThis as { __goliathDbProd?: PostgresJsDatabase<typeof schema> }).__goliathDbProd ??=
    drizzle(resolveSqlClient(), { schema, logger: process.env.LOG_LEVEL === 'debug' }))
}

/**
 * Raw postgres client, for migrations, seeds and the rare hand-written query.
 * A callable Proxy so `sqlClient\`select 1\`` and `sqlClient.end()` both work
 * while the underlying connection is still created on first use.
 */
export const sqlClient: Sql = new Proxy((() => {}) as unknown as Sql, {
  apply(_target, _thisArg, args) {
    return (resolveSqlClient() as unknown as (...a: unknown[]) => unknown)(...args)
  },
  get(_target, property, receiver) {
    return Reflect.get(resolveSqlClient() as object, property, receiver)
  },
  set(_target, property, value, receiver) {
    return Reflect.set(resolveSqlClient() as object, property, value, receiver)
  },
  has(_target, property) {
    return Reflect.has(resolveSqlClient() as object, property)
  },
})

/**
 * Unscoped handle.
 *
 * DO NOT import this in feature code. It exists for migrations, seeds and
 * genuinely cross-tenant platform work (Super Admin tooling, webhook intake).
 * Feature code must go through `tenantDb()` in `src/db/tenant-db.ts`, which
 * cannot express a query without a tenant predicate. ESLint enforces this.
 */
export const unsafeDb: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, property, receiver) {
      return Reflect.get(resolveDb() as object, property, receiver)
    },
    set(_target, property, value, receiver) {
      return Reflect.set(resolveDb() as object, property, value, receiver)
    },
    has(_target, property) {
      return Reflect.has(resolveDb() as object, property)
    },
  },
)

export type Database = PostgresJsDatabase<typeof schema>
export { schema }
