import type { TenantDb } from '@/db/tenant-db'
import { createCustomer } from '@/server/customers/service'
import { createLoad, type CreateLoadInput, type CreateLoadStopInput, type CreateLoadResult } from '@/server/loads/service'
import type { Role } from '@/lib/permissions'

export {
  createTestTenant,
  createTestUser,
  createTestMembership,
  createTestCarrier,
  approveCoiWithVins,
  newDot,
  goodVin,
  uniqueVin,
} from '../equipment/fixtures'

export async function createTestCustomer(
  db: TenantDb,
  actor: { userId: string },
  overrides: Partial<Parameters<typeof createCustomer>[2]> = {},
) {
  const result = await createCustomer(db, actor, { companyName: 'Acme Manufacturing LLC', ...overrides })
  if (result.status !== 'created') {
    throw new Error(`Expected test customer fixture to be created without conflict, got: ${JSON.stringify(result)}`)
  }
  return result.customer
}

/** Two stops, a pickup and a delivery, both in the near future — enough to satisfy `createLoad`'s minimum. */
export function minimalStops(offsetHours = 0): CreateLoadStopInput[] {
  const base = Date.now() + offsetHours * 60 * 60 * 1000
  return [
    {
      stopType: 'pickup',
      city: 'Houston',
      state: 'TX',
      postalCode: '77002',
      appointmentType: 'window',
      windowStart: new Date(base + 24 * 60 * 60 * 1000),
      windowEnd: new Date(base + 26 * 60 * 60 * 1000),
    },
    {
      stopType: 'delivery',
      city: 'Dallas',
      state: 'TX',
      postalCode: '75201',
      appointmentType: 'window',
      windowStart: new Date(base + 48 * 60 * 60 * 1000),
      windowEnd: new Date(base + 50 * 60 * 60 * 1000),
    },
  ]
}

export function minimalLoadInput(overrides: Partial<CreateLoadInput> & { customerId: string }): CreateLoadInput {
  return {
    weightPounds: 40_000,
    stops: minimalStops(),
    ...overrides,
  }
}

export async function createTestLoad(
  db: TenantDb,
  actor: { userId: string; role: Role | null },
  overrides: Partial<CreateLoadInput> & { customerId: string },
): Promise<CreateLoadResult> {
  return createLoad(db, actor, minimalLoadInput(overrides))
}
