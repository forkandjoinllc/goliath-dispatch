import 'server-only'
import { eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { tenantSettings } from '@/db/schema'

/**
 * Tenant-scoped sequential invoice numbers.
 *
 * MUST be called from inside a `db.transaction()` (see `createDraftInvoiceForLoad`).
 * `SELECT … FOR UPDATE` locks the tenant's settings row for the life of the
 * transaction, so two concurrent invoice creations cannot both read sequence
 * `1000` and mint the same number — the second call blocks until the first
 * commits (or rolls back), then reads the already-incremented value. This is
 * the same pattern `src/server/signatures/service.ts` uses to serialize
 * appends to a signature request's audit chain.
 */
export async function nextInvoiceNumber(tx: TenantDb): Promise<string> {
  const rows = await tx.builderRequiringExplicitTenantPredicate
    .select({
      prefix: tenantSettings.invoiceNumberPrefix,
      nextSequence: tenantSettings.invoiceNumberNextSequence,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tx.tenantId))
    .for('update')

  const settings = rows[0]
  if (!settings) {
    throw new Error(`tenant ${tx.tenantId} has no tenant_settings row; provisioning must create one`)
  }

  await tx.builderRequiringExplicitTenantPredicate
    .update(tenantSettings)
    .set({ invoiceNumberNextSequence: settings.nextSequence + 1 })
    .where(eq(tenantSettings.tenantId, tx.tenantId))

  return `${settings.prefix}-${settings.nextSequence}`
}
