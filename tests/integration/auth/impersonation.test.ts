// `./request-context` calls `vi.mock('next/headers', ...)` and must be the
// first thing this file imports — anything imported before it (notably
// `@/lib/auth/session` and `@/server/context`, both of which import
// `next/headers` themselves) would otherwise load the real, request-scoped
// implementation before the mock is registered.
import { resetTestRequestContext, setTestRequestHeaders, setTestSessionCookie } from './request-context'

import { describe, expect, it, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { auditEvents, impersonationSessions } from '@/db/schema'
import { createSession } from '@/lib/auth/session'
import { getActor } from '@/server/context'
import { endImpersonation, startImpersonation } from '@/server/auth/impersonation'
import { createTestMembership, createTestTenant, createTestUser } from './fixtures'

async function signInAs(userId: string, tenantId: string | null): Promise<void> {
  const { token } = await createSession({
    userId,
    activeTenantId: tenantId,
    ipAddress: '203.0.113.30',
    userAgent: 'vitest-impersonation',
    mfaSatisfied: true,
  })
  setTestSessionCookie(token)
  setTestRequestHeaders({ 'user-agent': 'vitest-impersonation', 'x-forwarded-for': '203.0.113.30' })
}

describe('impersonation', () => {
  beforeEach(() => {
    resetTestRequestContext()
  })

  it('a platform Super Admin impersonating a user in another tenant must open support access first, and both steps are audited', async () => {
    const tenant = await createTestTenant()
    const { user: superAdmin } = await createTestUser({ firstName: 'Sam', lastName: 'SuperAdmin', isPlatformSuperAdmin: true })
    const { user: targetUser } = await createTestUser({ firstName: 'Terry', lastName: 'Target' })
    await createTestMembership(tenant.id, targetUser.id, 'admin')

    await signInAs(superAdmin.id, null)

    const result = await startImpersonation({
      targetUserId: targetUser.id,
      tenantId: tenant.id,
      reason: 'Investigating a customer-reported billing discrepancy',
    })
    expect(result.impersonationSessionId).toBeTruthy()

    const [supportAccessEvent] = await unsafeDb
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'tenant.accessed'), eq(auditEvents.tenantId, tenant.id)))
    expect(supportAccessEvent).toBeDefined()
    expect(supportAccessEvent?.actorUserId).toBe(superAdmin.id)
    expect(supportAccessEvent?.reason).toContain('billing discrepancy')

    const [startedEvent] = await unsafeDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'impersonation.started'))
    expect(startedEvent).toBeDefined()
    // Both identities: who initiated it, and who they are now acting as.
    expect(startedEvent?.actorUserId).toBe(superAdmin.id)
    expect(startedEvent?.entityId).toBe(targetUser.id)
    expect(startedEvent?.reason).toContain('billing discrepancy')

    const [row] = await unsafeDb
      .select()
      .from(impersonationSessions)
      .where(eq(impersonationSessions.id, result.impersonationSessionId))
    expect(row?.actorUserId).toBe(superAdmin.id)
    expect(row?.targetUserId).toBe(targetUser.id)
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60_000)
  })

  it('rejects a reason shorter than the minimum length, before any permission check or audit write', async () => {
    const tenant = await createTestTenant()
    const { user: superAdmin } = await createTestUser({ isPlatformSuperAdmin: true })
    const { user: targetUser } = await createTestUser()
    await createTestMembership(tenant.id, targetUser.id, 'admin')
    await signInAs(superAdmin.id, null)

    await expect(
      startImpersonation({ targetUserId: targetUser.id, tenantId: tenant.id, reason: 'too short' }),
    ).rejects.toMatchObject({ messageKey: 'validation.minLength' })

    const events = await unsafeDb.select().from(auditEvents).where(eq(auditEvents.action, 'impersonation.started'))
    expect(events).toHaveLength(0)
  })

  it('refuses impersonation of oneself', async () => {
    const tenant = await createTestTenant()
    const { user: admin } = await createTestUser()
    await createTestMembership(tenant.id, admin.id, 'admin')
    await signInAs(admin.id, tenant.id)

    await expect(
      startImpersonation({ targetUserId: admin.id, tenantId: tenant.id, reason: 'Trying to impersonate myself' }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('an Admin impersonating within their own tenant does not require the platform support-access step', async () => {
    const tenant = await createTestTenant()
    const { user: admin } = await createTestUser({ firstName: 'Owner', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const { user: dispatcherUser } = await createTestUser({ firstName: 'Dee', lastName: 'Dispatcher' })
    await createTestMembership(tenant.id, dispatcherUser.id, 'dispatcher')

    await signInAs(admin.id, tenant.id)

    const result = await startImpersonation({
      targetUserId: dispatcherUser.id,
      tenantId: tenant.id,
      reason: 'Reproducing a dispatcher-reported bug',
    })
    expect(result.impersonationSessionId).toBeTruthy()

    const supportAccessEvents = await unsafeDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'tenant.accessed'))
    expect(supportAccessEvents).toHaveLength(0)
  })

  it('a dispatcher (no impersonate permission at all) is refused', async () => {
    const tenant = await createTestTenant()
    const { user: dispatcherUser } = await createTestUser()
    await createTestMembership(tenant.id, dispatcherUser.id, 'dispatcher')
    const { user: targetUser } = await createTestUser()
    await createTestMembership(tenant.id, targetUser.id, 'driver')

    await signInAs(dispatcherUser.id, tenant.id)

    await expect(
      startImpersonation({ targetUserId: targetUser.id, tenantId: tenant.id, reason: 'Not allowed to do this at all' }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('getActor() resolves the impersonated identity once impersonation has started, and endImpersonation audits both identities and reverts it', async () => {
    const tenant = await createTestTenant()
    const { user: superAdmin } = await createTestUser({ isPlatformSuperAdmin: true })
    const { user: targetUser } = await createTestUser({ firstName: 'Terry', lastName: 'Target' })
    await createTestMembership(tenant.id, targetUser.id, 'admin')

    await signInAs(superAdmin.id, null)
    await startImpersonation({
      targetUserId: targetUser.id,
      tenantId: tenant.id,
      reason: 'Investigating a support ticket end to end',
    })

    const actorWhileImpersonating = await getActor()
    expect(actorWhileImpersonating?.userId).toBe(targetUser.id)
    expect(actorWhileImpersonating?.impersonation?.actorUserId).toBe(superAdmin.id)
    expect(actorWhileImpersonating?.isPlatformSuperAdmin).toBe(false)

    await endImpersonation()

    const [endedEvent] = await unsafeDb.select().from(auditEvents).where(eq(auditEvents.action, 'impersonation.ended'))
    expect(endedEvent).toBeDefined()
    expect(endedEvent?.actorUserId).toBe(superAdmin.id)
    expect(endedEvent?.effectiveUserId).toBe(targetUser.id)

    const actorAfterEnding = await getActor()
    expect(actorAfterEnding?.userId).toBe(superAdmin.id)
    expect(actorAfterEnding?.impersonation).toBeNull()
  })
})
