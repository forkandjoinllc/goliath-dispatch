import 'server-only'
import { eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { tenantSettings } from '@/db/schema'
import { AppError } from '@/lib/errors'

/** Pure formatting — unit-tested without a database. */
export function formatLoadNumber(prefix: string, sequence: number): string {
  return `${prefix}-${sequence}`
}

/**
 * Allocates the next tenant-scoped load number.
 *
 * MUST be called from inside a `db.transaction()`. It locks the tenant's
 * single `tenant_settings` row with `SELECT … FOR UPDATE` (the same idiom as
 * `server/signatures/audit-chain.ts::appendSignatureAuditEvent` and
 * `server/signatures/service.ts::lockRequest`) before reading
 * `loadNumberNextSequence`, which is what makes two concurrent `createLoad`
 * calls allocate distinct numbers instead of racing to read the same value —
 * the second transaction blocks on the lock until the first commits (and
 * therefore sees the incremented sequence), rather than reading stale data.
 */
export async function allocateLoadNumber(db: TenantDb): Promise<string> {
  const rows = await db.builderRequiringExplicitTenantPredicate
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, db.tenantId))
    .for('update')
  const settings = rows[0]
  if (!settings) {
    throw new AppError('internal', 'errors.internal', { detail: { reason: 'missing_tenant_settings' } })
  }

  const sequence = settings.loadNumberNextSequence
  await db.update(tenantSettings, settings.id, { loadNumberNextSequence: sequence + 1 })
  return formatLoadNumber(settings.loadNumberPrefix, sequence)
}
