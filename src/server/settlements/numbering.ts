import 'server-only'
import { eq, sql } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { carrierSettlements } from '@/db/schema'

const SETTLEMENT_NUMBER_PREFIX = 'STL'
const SETTLEMENT_NUMBER_START = 1000

/**
 * Tenant-scoped sequential settlement numbers.
 *
 * `tenant_settings` carries a counter for invoices and loads but not
 * settlements (see `src/server/invoices/numbering.ts`), so this derives the
 * next number from the current max `carrier_settlements.settlement_number`
 * instead of a stored counter. A Postgres transactional advisory lock keyed
 * by the tenant id serializes concurrent callers so two settlements created
 * in the same instant cannot compute the same number; the lock releases
 * automatically at commit or rollback. MUST be called from inside a
 * `db.transaction()`.
 */
export async function nextSettlementNumber(tx: TenantDb): Promise<string> {
  await tx.builderRequiringExplicitTenantPredicate.execute(
    sql`select pg_advisory_xact_lock(hashtext(${tx.tenantId}::text || ':settlement_number'))`,
  )

  const rows = await tx.builderRequiringExplicitTenantPredicate
    .select({
      maxSequence: sql<number | null>`max(
        case when ${carrierSettlements.settlementNumber} like ${SETTLEMENT_NUMBER_PREFIX + '-%'}
          then nullif(split_part(${carrierSettlements.settlementNumber}, '-', 2), '')::int
          else null
        end
      )`,
    })
    .from(carrierSettlements)
    .where(eq(carrierSettlements.tenantId, tx.tenantId))

  const nextSequence = (rows[0]?.maxSequence ?? SETTLEMENT_NUMBER_START - 1) + 1
  return `${SETTLEMENT_NUMBER_PREFIX}-${nextSequence}`
}
