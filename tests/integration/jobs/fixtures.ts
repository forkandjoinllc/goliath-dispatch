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

export { createTestCustomer, createTestLoad, minimalLoadInput, minimalStops } from '../loads/fixtures'

let counter = 0

/** A stable-but-unique worker id, so parallel tests never collide on `locked_by`. */
export function testWorkerId(): string {
  counter += 1
  return `test-worker-${Date.now()}-${counter}`
}
