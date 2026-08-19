import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { carriers } from '@/db/schema'
import type { Actor } from '@/lib/permissions'
import { applyLegalHold, releaseLegalHold } from '@/server/retention/legal-holds'
import { retentionEligibilitySummary } from '@/server/retention/queries'
import { createTestCarrier, createTestTenant, createTestUser } from '../reports/fixtures'

const request = { ipAddress: null, userAgent: null, requestId: 'test-request' }

function adminActor(tenantId: string, userId: string): Actor & { tenantId: string } {
  return {
    userId,
    email: 'admin@example.test',
    firstName: 'Ada',
    lastName: 'Admin',
    locale: 'en',
    timezone: 'America/New_York',
    isPlatformSuperAdmin: false,
    tenantId,
    role: 'admin',
    carrierId: null,
    driverId: null,
    assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: null,
  }
}

/** Back-dates `createdAt` past the active window so a row is otherwise archive-eligible. */
async function backdateCreatedAt(db: ReturnType<typeof tenantDb>, carrierId: string, monthsAgo: number) {
  const date = new Date()
  date.setMonth(date.getMonth() - monthsAgo)
  await db.builderRequiringExplicitTenantPredicate
    .update(carriers)
    .set({ createdAt: date })
    .where(and(eq(carriers.tenantId, db.tenantId), eq(carriers.id, carrierId)))
}

describe('legal holds', () => {
  it('applying a tenant-wide hold marks a record held and excludes it from archive eligibility', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = adminActor(tenant.id, admin.id)

    const carrier = await createTestCarrier(db, admin.id)
    await backdateCreatedAt(db, carrier.id, 30) // past the 24-month default active window

    const beforeHold = await retentionEligibilitySummary(db)
    const carriersBefore = beforeHold.find((r) => r.entityType === 'carriers')!
    expect(carriersBefore.archiveEligibleCount).toBeGreaterThanOrEqual(1)
    expect(carriersBefore.heldCount).toBe(0)

    await applyLegalHold(db, actor, request, {
      name: 'Litigation hold — all records',
      reason: 'Outstanding litigation discovery request covering the full account.',
      scopeType: 'tenant',
    })

    const row = await db.findById(carriers, carrier.id)
    expect(row!.legalHold).toBe(true)

    const afterHold = await retentionEligibilitySummary(db)
    const carriersAfter = afterHold.find((r) => r.entityType === 'carriers')!
    expect(carriersAfter.heldCount).toBeGreaterThanOrEqual(1)
    // The held row is no longer counted as archive-eligible — this is the
    // data-layer half of "applying a legal hold blocks archival"; the actual
    // archival job (owned by the jobs agent) reads this same classification.
    expect(carriersAfter.archiveEligibleCount).toBe(0)
  })

  it('releasing one of two overlapping holds on the same record leaves it held', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = adminActor(tenant.id, admin.id)

    const carrier = await createTestCarrier(db, admin.id)

    const holdA = await applyLegalHold(db, actor, request, {
      name: 'Hold A — matter 1',
      reason: 'First matter requiring this carrier record to be preserved.',
      scopeType: 'record',
      entityType: 'carriers',
      entityId: carrier.id,
    })
    await applyLegalHold(db, actor, request, {
      name: 'Hold B — matter 2',
      reason: 'Second, independent matter also requiring this same record.',
      scopeType: 'record',
      entityType: 'carriers',
      entityId: carrier.id,
    })

    const rowAfterBothApplied = await db.findById(carriers, carrier.id)
    expect(rowAfterBothApplied!.legalHold).toBe(true)

    await releaseLegalHold(db, actor, request, {
      legalHoldId: holdA.id,
      releaseReason: 'Matter 1 has concluded; the record must remain held for matter 2.',
    })

    const rowAfterOneReleased = await db.findById(carriers, carrier.id)
    expect(rowAfterOneReleased!.legalHold).toBe(true)
  })

  it('releasing the last active hold on a record clears it', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = adminActor(tenant.id, admin.id)

    const carrier = await createTestCarrier(db, admin.id)

    const hold = await applyLegalHold(db, actor, request, {
      name: 'Only hold',
      reason: 'The only matter currently requiring this record to be preserved.',
      scopeType: 'record',
      entityType: 'carriers',
      entityId: carrier.id,
    })

    await releaseLegalHold(db, actor, request, {
      legalHoldId: hold.id,
      releaseReason: 'The matter has concluded and no other hold covers this record.',
    })

    const row = await db.findById(carriers, carrier.id)
    expect(row!.legalHold).toBe(false)
  })
})
