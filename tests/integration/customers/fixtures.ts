import type { TenantDb } from '@/db/tenant-db'
import { createCustomer, type CreateCustomerInput, type CreateCustomerResult } from '@/server/customers/service'

export { createTestTenant, createTestUser, createTestMembership, newDot } from '../carriers/fixtures'

/** A minimal, valid `createCustomer` input — override only what a test cares about. */
export function minimalCustomerInput(overrides: Partial<CreateCustomerInput> = {}): CreateCustomerInput {
  return {
    companyName: 'Acme Manufacturing LLC',
    ...overrides,
  }
}

/** Creates a customer and unwraps the `created` branch — fails loudly if a fixture accidentally collides with an existing duplicate. */
export async function createTestCustomer(
  db: TenantDb,
  actor: { userId: string },
  overrides: Partial<CreateCustomerInput> = {},
): Promise<Extract<CreateCustomerResult, { status: 'created' }>['customer']> {
  const result = await createCustomer(db, actor, minimalCustomerInput(overrides))
  if (result.status !== 'created') {
    throw new Error(`Expected test customer fixture to be created without conflict, got: ${JSON.stringify(result)}`)
  }
  return result.customer
}
