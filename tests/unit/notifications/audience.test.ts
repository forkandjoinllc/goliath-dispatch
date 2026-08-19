import { describe, expect, it } from 'vitest'
import { byPermission, type NotificationCandidate } from '@/server/notifications/catalog'

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const CARRIER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CARRIER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function assignments(carrierIds: string[]) {
  return { carrierIds, truckIds: [], trailerIds: [], driverIds: [], groupIds: [] }
}

describe('byPermission audience resolver', () => {
  it('excludes a dispatcher who is not assigned to the resource carrier', () => {
    const candidates: NotificationCandidate[] = [
      { userId: 'dispatcher-assigned', role: 'dispatcher', assignments: assignments([CARRIER_A]) },
      { userId: 'dispatcher-unassigned', role: 'dispatcher', assignments: assignments([CARRIER_B]) },
    ]

    const recipients = byPermission('document:read')(candidates, { tenantId: TENANT_ID, carrierId: CARRIER_A })

    expect(recipients).toContain('dispatcher-assigned')
    expect(recipients).not.toContain('dispatcher-unassigned')
  })

  it('always includes tenant-scope roles (admin) regardless of assignment', () => {
    const candidates: NotificationCandidate[] = [
      { userId: 'admin-1', role: 'admin', assignments: assignments([]) },
      { userId: 'dispatcher-unassigned', role: 'dispatcher', assignments: assignments([]) },
    ]

    const recipients = byPermission('document:read')(candidates, { tenantId: TENANT_ID, carrierId: CARRIER_A })

    expect(recipients).toContain('admin-1')
    expect(recipients).not.toContain('dispatcher-unassigned')
  })

  it('includes a carrier-role user only for their own carrier', () => {
    const candidates: NotificationCandidate[] = [
      { userId: 'carrier-user-a', role: 'carrier', carrierId: CARRIER_A },
      { userId: 'carrier-user-b', role: 'carrier', carrierId: CARRIER_B },
    ]

    const recipients = byPermission('document:read')(candidates, { tenantId: TENANT_ID, carrierId: CARRIER_A })

    expect(recipients).toEqual(['carrier-user-a'])
  })

  it('excludes every candidate when nobody holds the permission at all', () => {
    const candidates: NotificationCandidate[] = [{ userId: 'driver-1', role: 'driver' }]
    const recipients = byPermission('carrier:onboarding:approve')(candidates, {
      tenantId: TENANT_ID,
      carrierId: CARRIER_A,
    })
    expect(recipients).toEqual([])
  })
})
