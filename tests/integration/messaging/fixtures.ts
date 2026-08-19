import { unsafeDb } from '@/db/client'
import { carrierDispatcherAssignments } from '@/db/schema'
import type { Actor } from '@/lib/permissions'

export {
  createTestMembership,
  createTestTenant,
  createTestUser,
  minimalCarrierInput,
  newDot,
} from '../carriers/fixtures'

export async function assignDispatcherToCarrier(
  tenantId: string,
  carrierId: string,
  dispatcherUserId: string,
  assignedByUserId: string,
) {
  const [assignment] = await unsafeDb
    .insert(carrierDispatcherAssignments)
    .values({ tenantId, carrierId, dispatcherUserId, isPrimary: true, assignedByUserId })
    .returning()
  return assignment!
}

export function actorFor(tenantId: string, userId: string, overrides: Partial<Actor> = {}): Actor {
  return {
    userId,
    email: 'actor@example.test',
    firstName: 'Test',
    lastName: 'Actor',
    locale: 'en',
    timezone: 'America/Chicago',
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
    ...overrides,
  }
}
