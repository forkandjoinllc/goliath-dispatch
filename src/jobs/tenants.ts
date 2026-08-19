import 'server-only'
import { notInArray } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { tenants } from '@/db/schema'

/**
 * Cross-tenant sweep helpers.
 *
 * Every scheduled sweep (FMCSA reverification, document expiration, invoice
 * overdue, tracking ingestion/expiry, retention) has no ambient tenant — it
 * must enumerate tenants explicitly and run its per-tenant work through a
 * `TenantDb` bound to each one in turn. `unsafeDb` is used here, and only
 * here in this module, to read the `tenants` table itself; nothing else in
 * this file (or any handler) queries a tenant-owned table without going
 * through `tenantDb(tenantId)` first.
 */

/**
 * Tenants that should receive new operational work: reverification sweeps,
 * expiration warnings, overdue transitions, tracking polling. Excludes
 * `provisioning` (not yet a real, in-use tenant) and `suspended` (billing or
 * compliance has paused the account; do not generate new customer-facing
 * activity for it, though its data still ages normally for retention).
 */
export async function listSweepableTenantIds(): Promise<string[]> {
  const rows = await unsafeDb
    .select({ id: tenants.id })
    .from(tenants)
    .where(notInArray(tenants.status, ['provisioning', 'suspended']))
  return rows.map((r) => r.id)
}

/**
 * Every tenant that has ever been provisioned, regardless of current status.
 * Retention archival/purge must keep running for a suspended (or even
 * cancelled-but-not-yet-offboarded) tenant — the statutory clock on its data
 * does not pause because billing did.
 */
export async function listAllTenantIds(): Promise<string[]> {
  const rows = await unsafeDb.select({ id: tenants.id }).from(tenants)
  return rows.map((r) => r.id)
}
