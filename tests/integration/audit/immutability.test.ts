import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { auditEvents } from '@/db/schema'
import { tenantDb } from '@/db/tenant-db'
import { recordAudit } from '@/lib/audit'
import { listAuditEvents, listEventsByRequestId } from '@/server/audit/queries'
import { createTestTenant, createTestUser } from '../reports/fixtures'

const request = { ipAddress: '127.0.0.1', userAgent: 'vitest', requestId: 'audit-immutability-test' }

/**
 * `audit_events` is append-only by construction: a database trigger (see
 * `drizzle/custom/0001_audit_immutability.sql`) rejects UPDATE and DELETE
 * outright, and no code path in the application even attempts either — the
 * audit query layer (`src/server/audit/queries.ts`) exposes only reads.
 */
describe('audit_events is append-only at the database level', () => {
  it('rejects UPDATE even from an unrestricted database role', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = {
      userId: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      locale: 'en' as const,
      timezone: 'America/New_York',
      isPlatformSuperAdmin: false,
      tenantId: tenant.id,
      role: 'admin' as const,
      carrierId: null,
      driverId: null,
      assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
      overrides: [],
      mfaRequired: false,
      mfaSatisfied: true,
      impersonation: null,
      sessionId: null,
    }

    await recordAudit(actor, request, {
      action: 'settings.updated',
      entityType: 'tenant_settings',
      entityId: tenant.id,
      before: { name: 'Old Name' },
      after: { name: 'New Name' },
    })

    const [row] = await db.findMany(auditEvents, { where: eq(auditEvents.tenantId, tenant.id) })
    expect(row).toBeTruthy()

    await expect(
      unsafeDb.update(auditEvents).set({ reason: 'tampered' }).where(eq(auditEvents.id, row!.id)),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/i) } })
  })

  it('rejects DELETE even from an unrestricted database role', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = {
      userId: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      locale: 'en' as const,
      timezone: 'America/New_York',
      isPlatformSuperAdmin: false,
      tenantId: tenant.id,
      role: 'admin' as const,
      carrierId: null,
      driverId: null,
      assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
      overrides: [],
      mfaRequired: false,
      mfaSatisfied: true,
      impersonation: null,
      sessionId: null,
    }

    await recordAudit(actor, request, {
      action: 'settings.updated',
      entityType: 'tenant_settings',
      entityId: tenant.id,
      before: { name: 'Old Name' },
      after: { name: 'New Name' },
    })

    const [row] = await db.findMany(auditEvents, { where: eq(auditEvents.tenantId, tenant.id) })
    expect(row).toBeTruthy()

    await expect(unsafeDb.delete(auditEvents).where(eq(auditEvents.id, row!.id))).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only/i) },
    })
  })

  it('the read-only query layer can still list, filter by request id, and group related events', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = {
      userId: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      locale: 'en' as const,
      timezone: 'America/New_York',
      isPlatformSuperAdmin: false,
      tenantId: tenant.id,
      role: 'admin' as const,
      carrierId: null,
      driverId: null,
      assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
      overrides: [],
      mfaRequired: false,
      mfaSatisfied: true,
      impersonation: null,
      sessionId: null,
    }

    const sharedRequest = { ...request, requestId: `grouped-${tenant.id}` }
    await recordAudit(actor, sharedRequest, {
      action: 'settings.updated',
      entityType: 'tenant_settings',
      entityId: tenant.id,
      before: { name: 'Old Name' },
      after: { name: 'New Name' },
    })
    await recordAudit(actor, sharedRequest, {
      action: 'settings.updated',
      entityType: 'tenant_branding',
      entityId: tenant.id,
      before: { primaryColor: '#000000' },
      after: { primaryColor: '#111111' },
    })

    const grouped = await listEventsByRequestId(db, sharedRequest.requestId)
    expect(grouped.length).toBe(2)

    const listed = await listAuditEvents(db, {
      filters: { action: 'settings.updated' },
      pagination: { page: 1, pageSize: 10 },
    })
    expect(listed.total).toBeGreaterThanOrEqual(2)
  })
})
