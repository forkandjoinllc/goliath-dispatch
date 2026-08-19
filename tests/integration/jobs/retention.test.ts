import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { unsafeDb } from '@/db/client'
import { documents, loads, retentionJobs } from '@/db/schema'
import type { Actor } from '@/lib/permissions'
import { applyLegalHold } from '@/server/retention/legal-holds'
import { runRetentionArchiveSweep } from '@/jobs/handlers/retention-archive'
import { runRetentionPurgeSweep } from '@/jobs/handlers/retention-purge'
import {
  createTestCarrier,
  createTestCustomer,
  createTestLoad,
  createTestTenant,
  createTestUser,
  createTestMembership,
  minimalStops,
} from './fixtures'

const request = { ipAddress: null, userAgent: null, requestId: 'test-request' }
const fakeCtx = { jobId: 'test-job', tenantId: null, attempt: 1, maxAttempts: 1, workerId: 'test-worker' }

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

async function backdateDelivery(db: ReturnType<typeof tenantDb>, loadId: string, monthsAgo: number) {
  const date = new Date()
  date.setUTCMonth(date.getUTCMonth() - monthsAgo)
  await db.update(loads, loadId, { status: 'pod_received', actualDeliveryAt: date })
}

describe('retention archive + purge', () => {
  it('archive skips a load under legal hold and counts it separately from the one it does archive', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const actor = adminActor(tenant.id, admin.id)
    const customer = await createTestCustomer(db, { userId: admin.id })

    const { load: heldLoad } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, stops: minimalStops() })
    const { load: eligibleLoad } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, stops: minimalStops() })

    // Both delivered 30 months ago — well past the 24-month default active window.
    await backdateDelivery(db, heldLoad.id, 30)
    await backdateDelivery(db, eligibleLoad.id, 30)

    await applyLegalHold(db, actor, request, {
      name: 'Hold on one load',
      reason: 'Ongoing dispute requiring this specific load record to be preserved.',
      scopeType: 'record',
      entityType: 'loads',
      entityId: heldLoad.id,
    })

    await runRetentionArchiveSweep({}, fakeCtx)

    const heldAfter = await db.findById(loads, heldLoad.id)
    const eligibleAfter = await db.findById(loads, eligibleLoad.id)
    expect(heldAfter!.archivedAt).toBeNull()
    expect(eligibleAfter!.archivedAt).not.toBeNull()

    const jobRow = await db.findFirst(retentionJobs, { where: eq(retentionJobs.entityType, 'loads') })
    expect(jobRow).toBeTruthy()
    expect(jobRow!.processedCount).toBeGreaterThanOrEqual(1)
    expect(jobRow!.skippedLegalHoldCount).toBeGreaterThanOrEqual(1)
  })

  it('purge refuses to run without the explicit legal-hold-checked proof', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const customer = await createTestCustomer(db, { userId: admin.id })
    const { load } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, stops: minimalStops() })

    await expect(
      db.purge(loads, eq(loads.id, load.id), { legalHoldChecked: false } as unknown as { retentionJobId: string; legalHoldChecked: true }),
    ).rejects.toThrow(/legal-hold check/)

    // The row must still exist — a rejected proof must never fall through to deleting anyway.
    const stillThere = await db.findById(loads, load.id)
    expect(stillThere).toBeTruthy()
  })

  // `loads` can never go through the real delete step — their append-only
  // `load_status_history`/`financial_snapshots` children make a real
  // `DELETE FROM loads` fail at the database level, by design (see
  // `docs/architecture.md` §9). `retention-purge.ts` anonymizes an archived
  // load instead; that path is exercised separately below. `documents` has
  // no such blocking child and purges cleanly, so it is what exercises the
  // real delete path end-to-end here.
  it('purge skips an archived document under legal hold, deletes the one that is not, and never deletes without proof', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const actor = adminActor(tenant.id, admin.id)
    const carrier = await createTestCarrier(db, admin.id)

    const longAgo = new Date()
    longAgo.setUTCFullYear(longAgo.getUTCFullYear() - 10)
    const heldDocument = await db.insert(documents, {
      documentType: 'certificate_of_insurance',
      ownerType: 'carrier',
      ownerId: carrier.id,
      reviewStatus: 'approved',
      archivedAt: longAgo,
      purgeEligibleAt: longAgo,
    })
    const eligibleDocument = await db.insert(documents, {
      documentType: 'certificate_of_insurance',
      ownerType: 'carrier',
      ownerId: carrier.id,
      reviewStatus: 'approved',
      archivedAt: longAgo,
      purgeEligibleAt: longAgo,
    })

    await applyLegalHold(db, actor, request, {
      name: 'Hold on one archived document',
      reason: 'Ongoing dispute requiring this specific archived document to be preserved.',
      scopeType: 'record',
      entityType: 'documents',
      entityId: heldDocument.id,
    })

    await runRetentionPurgeSweep({}, fakeCtx)

    const heldAfter = await db.findById(documents, heldDocument.id)
    const eligibleAfter = await db.findById(documents, eligibleDocument.id)
    expect(heldAfter).toBeTruthy() // still exists — never purged
    expect(eligibleAfter).toBeNull() // actually deleted

    const jobRow = await db.findFirst(retentionJobs, { where: eq(retentionJobs.entityType, 'documents') })
    expect(jobRow!.processedCount).toBeGreaterThanOrEqual(1)
    expect(jobRow!.skippedLegalHoldCount).toBeGreaterThanOrEqual(1)
  })

  it('purge anonymizes a load past its purge-eligible date instead of deleting it, skips one under legal hold, and converges on a second run', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const actor = adminActor(tenant.id, admin.id)
    const customer = await createTestCustomer(db, { userId: admin.id })

    const { load: heldLoad } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, stops: minimalStops() })
    const { load: eligibleLoad } = await createTestLoad(
      db,
      { userId: admin.id, role: 'admin' },
      { customerId: customer.id, stops: minimalStops() },
    )

    const longAgo = new Date()
    longAgo.setUTCFullYear(longAgo.getUTCFullYear() - 10)
    await db.update(loads, heldLoad.id, { archivedAt: longAgo, purgeEligibleAt: longAgo })
    await db.update(loads, eligibleLoad.id, {
      archivedAt: longAgo,
      purgeEligibleAt: longAgo,
      customerReference: 'REF-12345',
      internalNotes: 'Do not disclose to carrier.',
    })

    await applyLegalHold(db, actor, request, {
      name: 'Hold on one load',
      reason: 'Ongoing dispute requiring this specific load record to be preserved.',
      scopeType: 'record',
      entityType: 'loads',
      entityId: heldLoad.id,
    })

    await runRetentionPurgeSweep({}, fakeCtx)

    // The held load is untouched — still readable through the ordinary
    // tenant-scoped path, still carrying its original content.
    const heldAfter = await db.findById(loads, heldLoad.id)
    expect(heldAfter).toBeTruthy()
    expect(heldAfter!.deletedAt).toBeNull()

    // The eligible load is never hard-deleted (the row still exists), but it
    // is soft-deleted — invisible through the ordinary tenant-scoped path —
    // and its free-text columns are redacted rather than left intact.
    const eligibleViaTenantDb = await db.findById(loads, eligibleLoad.id)
    expect(eligibleViaTenantDb).toBeNull()

    const [rawRow] = await unsafeDb.select().from(loads).where(eq(loads.id, eligibleLoad.id))
    expect(rawRow).toBeTruthy()
    expect(rawRow!.deletedAt).not.toBeNull()
    expect(rawRow!.customerReference).toBeNull()
    expect(rawRow!.internalNotes).not.toBe('Do not disclose to carrier.')

    const jobRow = await db.findFirst(retentionJobs, { where: eq(retentionJobs.entityType, 'loads') })
    expect(jobRow!.action).toBe('anonymize')
    expect(jobRow!.processedCount).toBeGreaterThanOrEqual(1)
    expect(jobRow!.skippedLegalHoldCount).toBeGreaterThanOrEqual(1)

    // Idempotent: a second sweep must not re-select (or re-audit) the
    // already-anonymized load.
    const processedBefore = jobRow!.processedCount
    await runRetentionPurgeSweep({}, fakeCtx)
    const [rawRowAfterSecondRun] = await unsafeDb.select().from(loads).where(eq(loads.id, eligibleLoad.id))
    expect(rawRowAfterSecondRun!.deletedAt!.getTime()).toBe(rawRow!.deletedAt!.getTime())
    const jobRows = await db.findMany(retentionJobs, { where: eq(retentionJobs.entityType, 'loads') })
    const secondRun = jobRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    expect(secondRun!.processedCount).toBe(0)
    expect(processedBefore).toBeGreaterThanOrEqual(1)
  })
})
