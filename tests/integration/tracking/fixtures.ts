import { eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { drivers, loadStops, type Load, type LoadStop } from '@/db/schema'
import { createDriver } from '@/server/drivers/service'
import { grantTrackingConsent } from '@/server/tracking/sessions'
import { createTestUser } from '../equipment/fixtures'

export {
  createTestTenant,
  createTestUser,
  createTestMembership,
  createTestCarrier,
  newDot,
} from '../equipment/fixtures'
export { createTestCustomer, createTestLoad, minimalLoadInput, minimalStops } from '../loads/fixtures'

/**
 * `createLoad` (owned by the loads agent) never sets stop coordinates —
 * geocoding those is a separate concern this release doesn't automate — so
 * every route/tracking-session fixture that needs routable stops sets them
 * directly. `waypoints[i]` is applied to the i-th stop in `sequence` order.
 */
export async function setStopCoordinates(
  db: TenantDb,
  loadId: string,
  waypoints: Array<{ lat: number; lng: number }>,
): Promise<LoadStop[]> {
  const stops = (await db.findMany(loadStops, { where: eq(loadStops.loadId, loadId) })).sort(
    (a, b) => a.sequence - b.sequence,
  )
  const updated: LoadStop[] = []
  for (let i = 0; i < stops.length; i += 1) {
    const point = waypoints[i]
    if (!point) continue
    const row = await db.update(loadStops, stops[i]!.id, { latitude: String(point.lat), longitude: String(point.lng) })
    if (row) updated.push(row)
  }
  return updated
}

/** Houston → Dallas — the same two cities `loads/fixtures.ts`'s `minimalStops` uses. */
export function houstonToDallasWaypoints(): Array<{ lat: number; lng: number }> {
  return [
    { lat: 29.7601, lng: -95.3701 },
    { lat: 32.7767, lng: -96.797 },
  ]
}

/** Creates a driver, links it to a fresh user account, and (unless `withConsent` is false) grants tracking consent for that user. */
export async function createTestDriverWithConsent(
  db: TenantDb,
  input: { withConsent?: boolean } = {},
): Promise<{ driver: Awaited<ReturnType<typeof createDriver>>; userId: string }> {
  const user = await createTestUser({ firstName: 'Dana', lastName: 'Driver' })

  const driver = await createDriver(db, { userId: user.id }, {
    firstName: 'Dana',
    lastName: 'Driver',
    preferredLocale: 'en',
  })
  const linked = await db.update(drivers, driver.id, { userId: user.id })

  if (input.withConsent !== false) {
    await grantTrackingConsent(db, { userId: user.id })
  }

  return { driver: linked ?? driver, userId: user.id }
}

export type { Load }
