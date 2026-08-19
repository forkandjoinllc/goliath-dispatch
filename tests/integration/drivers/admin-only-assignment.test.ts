import { describe, expect, it } from 'vitest'
import { can, type Actor } from '@/lib/permissions'

/**
 * `assignment:manage` (carrier↔dispatcher assignment, dispatcher resource
 * grants, and group management) is granted to exactly one role in the
 * matrix: Admin. This is a pure `can()` check — no database needed — the
 * same guarantee `server/assignments/actions.ts` and
 * `server/carriers/actions.ts` rely on by requiring this permission on
 * every mutation in both modules.
 */

function actorWithRole(role: Actor['role']): Actor {
  return {
    userId: 'user-1',
    email: 'x@example.test',
    firstName: 'X',
    lastName: 'Y',
    locale: 'en',
    timezone: 'America/Chicago',
    isPlatformSuperAdmin: false,
    tenantId: 'tenant-1',
    role,
    carrierId: role === 'carrier' ? 'carrier-1' : null,
    driverId: null,
    assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: null,
  }
}

describe('assignment:manage is Admin-only', () => {
  it('grants admin the permission at tenant scope', () => {
    const decision = can(actorWithRole('admin'), 'assignment:manage')
    expect(decision.allowed).toBe(true)
    expect(decision.scope).toBe('tenant')
  })

  it('denies accounting', () => {
    expect(can(actorWithRole('accounting'), 'assignment:manage').allowed).toBe(false)
  })

  it('denies dispatcher — a dispatcher may not assign carriers, equipment, drivers or groups to themselves or anyone else', () => {
    expect(can(actorWithRole('dispatcher'), 'assignment:manage').allowed).toBe(false)
  })

  it('denies carrier', () => {
    expect(can(actorWithRole('carrier'), 'assignment:manage').allowed).toBe(false)
  })

  it('denies driver', () => {
    expect(can(actorWithRole('driver'), 'assignment:manage').allowed).toBe(false)
  })

  it('denies platform super admin outside an explicit support session (no tenant matrix entry)', () => {
    const actor = actorWithRole('platform_super_admin')
    expect(can(actor, 'assignment:manage').allowed).toBe(false)
  })
})
