import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { createDriver } from '@/server/drivers/service'
import { grantDispatcherResource, revokeDispatcherResource } from '@/server/assignments/service'
import { dispatcherReach } from '@/server/assignments/queries'
import { createTestTenant, createTestUser } from './fixtures'

describe('dispatcher resource grants', () => {
  it('grants a driver directly to a dispatcher and reflects it in their reach; revoking removes it but keeps history', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dispatcherUser = await createTestUser({ firstName: 'Dee', lastName: 'Dispatcher' })
    const db = tenantDb(tenant.id)

    const driver = await createDriver(db, { userId: admin.id }, {
      firstName: 'Hank',
      lastName: 'Hauler',
      preferredLocale: 'en',
    })

    const reachBefore = await dispatcherReach(db, dispatcherUser.id)
    expect(reachBefore.driverIds).not.toContain(driver.id)

    const grant = await grantDispatcherResource(db, { userId: admin.id }, {
      dispatcherUserId: dispatcherUser.id,
      resourceType: 'driver',
      resourceId: driver.id,
      reason: 'Covers this driver while the primary dispatcher is out.',
    })
    expect(grant.dispatcherUserId).toBe(dispatcherUser.id)

    const reachAfter = await dispatcherReach(db, dispatcherUser.id)
    expect(reachAfter.driverIds).toContain(driver.id)

    await revokeDispatcherResource(db, { userId: admin.id }, {
      dispatcherUserId: dispatcherUser.id,
      resourceType: 'driver',
      resourceId: driver.id,
    })

    const reachAfterRevoke = await dispatcherReach(db, dispatcherUser.id)
    expect(reachAfterRevoke.driverIds).not.toContain(driver.id)
  })

  it('refuses a second active grant of the same resource to the same dispatcher', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dispatcherUser = await createTestUser({ firstName: 'Dee', lastName: 'Dispatcher' })
    const db = tenantDb(tenant.id)

    const driver = await createDriver(db, { userId: admin.id }, { firstName: 'Hank', lastName: 'Hauler', preferredLocale: 'en' })

    await grantDispatcherResource(db, { userId: admin.id }, {
      dispatcherUserId: dispatcherUser.id,
      resourceType: 'driver',
      resourceId: driver.id,
    })

    await expect(
      grantDispatcherResource(db, { userId: admin.id }, {
        dispatcherUserId: dispatcherUser.id,
        resourceType: 'driver',
        resourceId: driver.id,
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})
