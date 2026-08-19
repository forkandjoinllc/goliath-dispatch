import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { documentExpirations, documents, notifications } from '@/db/schema'
import { runSweep } from '@/jobs/handlers/document-expiration'
import { createTestCarrier, createTestTenant, createTestUser, createTestMembership } from './fixtures'

const fakeCtx = { jobId: 'test-job', tenantId: null, attempt: 1, maxAttempts: 1, workerId: 'test-worker' }

describe('document expiration sweep', () => {
  it('running the sweep twice materializes one expirations row and emits one round of notifications, not two', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)

    const expirationDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) // 10 days out, inside the 30-day default warning window
    const document = await db.insert(documents, {
      documentType: 'certificate_of_insurance',
      ownerType: 'carrier',
      ownerId: carrier.id,
      reviewStatus: 'approved',
      isRequired: true,
      expirationDate,
    })

    await runSweep({}, fakeCtx)

    const expirationsAfterFirst = await db.findMany(documentExpirations, { where: eq(documentExpirations.documentId, document.id) })
    expect(expirationsAfterFirst).toHaveLength(1)
    expect(expirationsAfterFirst[0]!.notifiedAt).not.toBeNull()

    const notificationsAfterFirst = await db.count(notifications, eq(notifications.userId, admin.id))
    expect(notificationsAfterFirst).toBeGreaterThan(0)

    // Re-running the same sweep (as the daily cron would on any day nothing
    // changed) must not materialize a second expirations row nor send a
    // second round of notifications for the same expiration date.
    await runSweep({}, fakeCtx)

    const expirationsAfterSecond = await db.findMany(documentExpirations, { where: eq(documentExpirations.documentId, document.id) })
    expect(expirationsAfterSecond).toHaveLength(1)

    const notificationsAfterSecond = await db.count(notifications, eq(notifications.userId, admin.id))
    expect(notificationsAfterSecond).toBe(notificationsAfterFirst)
  })
})
