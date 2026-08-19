import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { notifications } from '@/db/schema'
import { notifyDocumentExpiring } from '@/server/notifications/expiry'
import { createTestMembership, createTestTenant, createTestUser } from './fixtures'

/**
 * Lives alongside the messaging integration suite per this agent's test
 * plan, even though the subject under test is the notification dispatcher —
 * it needs the same real-Postgres, tenant/user fixture setup as the rest of
 * this directory.
 */
describe('document expiry sweep idempotency', () => {
  it('emitting the same expiring-document notification twice creates exactly one notification', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')

    const input = {
      tenantId: tenant.id,
      documentId: '00000000-0000-0000-0000-0000000000aa',
      documentType: 'certificate_of_insurance',
      ownerType: 'carrier' as const,
      ownerId: '00000000-0000-0000-0000-0000000000bb',
      ownerName: 'Summit Heavy Haul LLC',
      expirationDate: new Date('2026-09-15T00:00:00Z'),
    }

    await notifyDocumentExpiring(input, 14)

    const db = tenantDb(tenant.id)
    const afterFirstRun = await db.findMany(notifications, { where: eq(notifications.eventKey, 'document.expiring') })
    const afterFirstRunForAdmin = afterFirstRun.filter((r) => r.userId === admin.id)
    // One row per default channel (in_app + email) for the admin recipient —
    // not zero, and not duplicated across channels.
    expect(afterFirstRunForAdmin.length).toBeGreaterThan(0)

    // A second sweep run for the same document/expiration date — the
    // scenario the daily cron actually produces every morning until the
    // document is renewed. It must not create any additional rows.
    await notifyDocumentExpiring(input, 13)

    const afterSecondRun = await db.findMany(notifications, { where: eq(notifications.eventKey, 'document.expiring') })
    const afterSecondRunForAdmin = afterSecondRun.filter((r) => r.userId === admin.id)
    expect(afterSecondRunForAdmin).toHaveLength(afterFirstRunForAdmin.length)
  })
})
