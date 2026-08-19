import 'server-only'
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core'
import { unsafeDb, type Database } from './client'
import { notFound } from '@/lib/errors'

/**
 * Tenant-scoped data access.
 *
 * Feature code never touches `unsafeDb`. Everything goes through a handle bound
 * to exactly one tenant, and every helper injects `tenant_id = $tenant` plus the
 * soft-delete predicate. It is not possible to express a cross-tenant read here
 * without deliberately reaching for the escape hatch, which names itself.
 *
 * Database triggers (drizzle/custom/0002_tenant_guards.sql) provide the second
 * layer: even a hand-written query cannot link rows across tenants.
 */

type TenantTable = PgTable & {
  tenantId: PgColumn
  id: PgColumn
  deletedAt?: PgColumn
}

export interface QueryOptions {
  where?: SQL
  orderBy?: SQL | SQL[]
  limit?: number
  offset?: number
  /** Include soft-deleted rows. Off by default; auditing screens opt in. */
  includeDeleted?: boolean
}

export class TenantDb {
  constructor(
    readonly tenantId: string,
    private readonly db: Database = unsafeDb,
  ) {
    if (!tenantId) throw new Error('TenantDb requires a tenantId')
  }

  /** The mandatory predicate every query in this class is built on. */
  scope(table: TenantTable, extra?: SQL, includeDeleted = false): SQL {
    const clauses: SQL[] = [eq(table.tenantId, this.tenantId)]
    if (!includeDeleted && table.deletedAt) clauses.push(isNull(table.deletedAt))
    if (extra) clauses.push(extra)
    return and(...clauses)!
  }

  async findMany<T extends TenantTable>(table: T, options: QueryOptions = {}) {
    let query = this.db
      .select()
      .from(table as PgTable)
      .where(this.scope(table, options.where, options.includeDeleted))
      .$dynamic()

    if (options.orderBy) {
      const order = Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy]
      query = query.orderBy(...order)
    }
    if (options.limit != null) query = query.limit(options.limit)
    if (options.offset != null) query = query.offset(options.offset)

    return (await query) as T['$inferSelect'][]
  }

  async findFirst<T extends TenantTable>(table: T, options: QueryOptions = {}) {
    const rows = await this.findMany(table, { ...options, limit: 1 })
    return (rows[0] ?? null) as T['$inferSelect'] | null
  }

  async findById<T extends TenantTable>(table: T, id: string, includeDeleted = false) {
    return this.findFirst(table, { where: eq(table.id, id), includeDeleted })
  }

  /** Same as findById but throws a 404-shaped AppError when absent. */
  async requireById<T extends TenantTable>(table: T, id: string, entityKey = 'entity') {
    const row = await this.findById(table, id)
    if (!row) throw notFound('errors.notFound', { entity: entityKey })
    return row as NonNullable<T['$inferSelect']>
  }

  async count(table: TenantTable, where?: SQL, includeDeleted = false): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(table as PgTable)
      .where(this.scope(table, where, includeDeleted))
    return row?.value ?? 0
  }

  async exists(table: TenantTable, where: SQL): Promise<boolean> {
    return (await this.count(table, where)) > 0
  }

  /** Inserts with `tenant_id` forced to this handle's tenant. */
  async insert<T extends TenantTable>(
    table: T,
    values: Omit<T['$inferInsert'], 'tenantId'> & { tenantId?: never },
  ) {
    const [row] = await this.db
      .insert(table as PgTable)
      .values({ ...(values as Record<string, unknown>), tenantId: this.tenantId } as T['$inferInsert'])
      .returning()
    return row as T['$inferSelect']
  }

  async insertMany<T extends TenantTable>(
    table: T,
    values: Array<Omit<T['$inferInsert'], 'tenantId'>>,
  ) {
    if (values.length === 0) return [] as T['$inferSelect'][]
    const rows = await this.db
      .insert(table as PgTable)
      .values(
        values.map((v) => ({ ...(v as Record<string, unknown>), tenantId: this.tenantId })) as T['$inferInsert'][],
      )
      .returning()
    return rows as T['$inferSelect'][]
  }

  /** Updates only rows inside this tenant; the id alone is never sufficient. */
  async update<T extends TenantTable>(
    table: T,
    id: string,
    values: Partial<Omit<T['$inferInsert'], 'tenantId' | 'id'>>,
  ) {
    const [row] = await this.db
      .update(table as PgTable)
      .set(values as Record<string, unknown>)
      .where(this.scope(table, eq(table.id, id)))
      .returning()
    return (row ?? null) as T['$inferSelect'] | null
  }

  async updateWhere<T extends TenantTable>(
    table: T,
    where: SQL,
    values: Partial<Omit<T['$inferInsert'], 'tenantId' | 'id'>>,
  ) {
    const rows = await this.db
      .update(table as PgTable)
      .set(values as Record<string, unknown>)
      .where(this.scope(table, where))
      .returning()
    return rows as T['$inferSelect'][]
  }

  /**
   * Soft deletion is the default everywhere. Hard deletion exists only in the
   * retention pipeline, which calls `purge()` explicitly and records why.
   */
  async softDelete<T extends TenantTable>(
    table: T,
    id: string,
    deletedByUserId: string,
    reason?: string,
  ) {
    return this.update(table, id, {
      deletedAt: new Date(),
      deletedBy: deletedByUserId,
      deletionReason: reason ?? null,
    } as Partial<T['$inferInsert']>)
  }

  async restore<T extends TenantTable>(table: T, id: string) {
    const [row] = await this.db
      .update(table as PgTable)
      .set({ deletedAt: null, deletedBy: null, deletionReason: null })
      .where(and(eq(table.tenantId, this.tenantId), eq(table.id, id))!)
      .returning()
    return (row ?? null) as T['$inferSelect'] | null
  }

  /**
   * Permanent removal. Reserved for the retention job after the statutory
   * window has elapsed and no legal hold applies — callers must prove both.
   */
  async purge<T extends TenantTable>(
    table: T,
    where: SQL,
    proof: { retentionJobId: string; legalHoldChecked: true },
  ) {
    if (!proof.legalHoldChecked) {
      throw new Error('purge() requires an explicit legal-hold check')
    }
    const rows = await this.db
      .delete(table as PgTable)
      .where(and(eq(table.tenantId, this.tenantId), where)!)
      .returning({ id: table.id })
    return rows.length
  }

  /** Transaction whose callback receives a TenantDb bound to the same tenant. */
  async transaction<R>(callback: (tx: TenantDb) => Promise<R>): Promise<R> {
    return this.db.transaction(async (tx) => callback(new TenantDb(this.tenantId, tx as Database)))
  }

  /**
   * Escape hatch for joins and aggregates Drizzle's helper API cannot express.
   * The name is deliberately awkward: every call site should be reviewable, and
   * the caller remains responsible for adding the tenant predicate — use
   * `scope()` to build it.
   */
  get builderRequiringExplicitTenantPredicate(): Database {
    return this.db
  }
}

export function tenantDb(tenantId: string): TenantDb {
  return new TenantDb(tenantId)
}
