import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { expenseCategories, financialSnapshots } from '@/db/schema'
import { tenantDb } from '@/db/tenant-db'
import type { Actor } from '@/lib/permissions'
import { onFinancialInputChanged, latestSnapshot, snapshotHistory, updateLoadFinancialInputs } from '@/server/finance/snapshots'
import { approveExpense, submitExpense } from '@/server/finance/expenses'
import { createTestCarrier, createTestCustomer, createTestLoad, createTestTenant, createTestUser } from './fixtures'

function actorFor(userId: string): Actor {
  return { userId } as unknown as Actor
}

async function setup() {
  const tenant = await createTestTenant()
  const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
  const db = tenantDb(tenant.id)
  const carrier = await createTestCarrier(db, admin.id)
  const customer = await createTestCustomer(db)
  const load = await createTestLoad(db, {
    carrierId: carrier.id,
    customerId: customer.id,
    customerChargeCents: 200_000,
    carrierGrossRateCents: 150_000,
    carrierDispatchFeeBps: 1000,
    dispatcherCommissionBps: 2500,
  })
  return { tenant, admin, db, carrier, customer, load }
}

describe('financial snapshot versioning', () => {
  it('recomputing writes a brand-new row rather than updating the previous one', async () => {
    const { db, load, admin } = await setup()

    const first = await onFinancialInputChanged(db, load.id, { reason: 'test_initial', actorUserId: admin.id })
    expect(first.snapshot.version).toBe(1)
    expect(first.previous).toBeNull()

    const second = await onFinancialInputChanged(db, load.id, { reason: 'test_recompute', actorUserId: admin.id })
    expect(second.snapshot.version).toBe(2)
    expect(second.snapshot.id).not.toBe(first.snapshot.id)
    expect(second.previous?.id).toBe(first.snapshot.id)

    const history = await snapshotHistory(db, load.id)
    expect(history.map((s) => s.version)).toEqual([2, 1])

    // The first row is untouched — still readable by id, still version 1.
    const stillThere = await unsafeDb
      .select()
      .from(financialSnapshots)
      .where(eq(financialSnapshots.id, first.snapshot.id))
    expect(stillThere[0]?.version).toBe(1)
  })

  it('the database trigger rejects a direct UPDATE to a computed column', async () => {
    const { db, load, admin } = await setup()
    const { snapshot } = await onFinancialInputChanged(db, load.id, { reason: 'test', actorUserId: admin.id })

    await expect(
      unsafeDb
        .update(financialSnapshots)
        .set({ netCarrierSettlementCents: 1 })
        .where(eq(financialSnapshots.id, snapshot.id)),
    ).rejects.toThrow()

    const reread = await unsafeDb.select().from(financialSnapshots).where(eq(financialSnapshots.id, snapshot.id))
    expect(reread[0]?.netCarrierSettlementCents).toBe(snapshot.netCarrierSettlementCents)
  })

  it('the trigger also rejects deleting a snapshot row', async () => {
    const { db, load, admin } = await setup()
    const { snapshot } = await onFinancialInputChanged(db, load.id, { reason: 'test', actorUserId: admin.id })

    await expect(
      unsafeDb.delete(financialSnapshots).where(eq(financialSnapshots.id, snapshot.id)),
    ).rejects.toThrow()
  })

  it('changing a fee percentage after the fact creates a new version and never rewrites the historical one', async () => {
    const { db, load, admin } = await setup()

    const settled = await onFinancialInputChanged(db, load.id, { reason: 'initial', actorUserId: admin.id })
    expect(settled.snapshot.carrierDispatchFeeBps).toBe(1000)
    expect(settled.snapshot.dispatchFeeAmountCents).toBe(15_000) // 150,000 * 10%

    const afterFeeChange = await updateLoadFinancialInputs(db, { userId: admin.id }, load.id, {
      carrierDispatchFeeBps: 2000, // fee changed to 20% AFTER the load was "settled"
    })
    expect(afterFeeChange.snapshot.version).toBe(2)
    expect(afterFeeChange.snapshot.carrierDispatchFeeBps).toBe(2000)
    expect(afterFeeChange.snapshot.dispatchFeeAmountCents).toBe(30_000) // 150,000 * 20%

    // The historical (version 1) snapshot is byte-for-byte unchanged.
    const historicalRow = await unsafeDb
      .select()
      .from(financialSnapshots)
      .where(eq(financialSnapshots.id, settled.snapshot.id))
    expect(historicalRow[0]?.carrierDispatchFeeBps).toBe(1000)
    expect(historicalRow[0]?.dispatchFeeAmountCents).toBe(15_000)

    const latest = await latestSnapshot(db, load.id)
    expect(latest?.version).toBe(2)
    expect(latest?.dispatchFeeAmountCents).toBe(30_000)
  })

  it('approving an expense triggers a recompute and a new snapshot version', async () => {
    const { db, load, admin } = await setup()

    const baseline = await onFinancialInputChanged(db, load.id, { reason: 'initial', actorUserId: admin.id })
    expect(baseline.snapshot.version).toBe(1)
    expect(baseline.snapshot.approvedExcludedExpensesCents).toBe(0)

    // Seed a system-like excluded-from-commission category for this test.
    const category = await db.insert(expenseCategories, {
      code: 'permits',
      labelEn: 'Permits',
      labelEs: 'Permisos',
      treatment: 'excluded_from_commission',
      isSystem: true,
      requiresReceipt: false,
    })

    const expense = await submitExpense(db, actorFor(admin.id), {
      loadId: load.id,
      categoryId: category.id,
      amountCents: 10_000,
    })
    expect(expense.status).toBe('submitted')

    // Submission alone must NOT recompute — only approval does.
    const afterSubmit = await latestSnapshot(db, load.id)
    expect(afterSubmit?.version).toBe(1)

    const approved = await approveExpense(db, actorFor(admin.id), expense.id)
    expect(approved.status).toBe('approved')

    const afterApproval = await latestSnapshot(db, load.id)
    expect(afterApproval?.version).toBe(2)
    expect(afterApproval?.approvedExcludedExpensesCents).toBe(10_000)
    // commissionableBase = 150,000 - 10,000 = 140,000; fee = 14,000 (10%).
    expect(afterApproval?.commissionableBaseCents).toBe(140_000)
    expect(afterApproval?.dispatchFeeAmountCents).toBe(14_000)
  })
})
