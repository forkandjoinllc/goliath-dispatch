import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { publicTrackingLinks } from '@/db/schema'
import { isAppError } from '@/lib/errors'
import {
  createPublicTrackingLink,
  resolvePublicTrackingLink,
  revokePublicTrackingLink,
} from '@/server/tracking/public-links'
import {
  createTestCarrier,
  createTestCustomer,
  createTestLoad,
  createTestMembership,
  createTestTenant,
  createTestUser,
  houstonToDallasWaypoints,
  setStopCoordinates,
} from './fixtures'

/**
 * Public tracking links: expiry, revocation, and cross-tenant isolation.
 * `resolvePublicTrackingLink` takes no `Actor` — the raw token's own
 * `{tenantId}.{secret}` shape is what routes resolution to the correct
 * tenant, so these tests exercise that structural guarantee directly
 * against Postgres rather than mocking it.
 */

let ipCounter = 0
/** A fresh, never-before-used loopback IP per test so the process-local rate limiter never interferes between tests. */
function freshIp(): string {
  ipCounter += 1
  return `10.0.0.${ipCounter}`
}

async function setUpLoadWithLink(ttlHours: number) {
  const tenant = await createTestTenant()
  const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
  await createTestMembership(tenant.id, admin.id, 'admin')
  const db = tenantDb(tenant.id)

  const carrier = await createTestCarrier(db, admin.id)
  const customer = await createTestCustomer(db, { userId: admin.id })
  const { load } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, {
    customerId: customer.id,
    carrierId: carrier.id,
  })
  await setStopCoordinates(db, load.id, houstonToDallasWaypoints())

  const { link, rawToken } = await createPublicTrackingLink(db, { loadId: load.id, ttlHours })

  return { tenant, db, load, link, rawToken }
}

describe('public tracking links — resolution, expiry, revocation', () => {
  it('resolves successfully before expiry with the narrow public projection', async () => {
    const { load, rawToken } = await setUpLoadWithLink(72)

    const projection = await resolvePublicTrackingLink(rawToken, freshIp())
    expect(projection.loadNumber).toBe(load.loadNumber)
    expect(projection.originCity).toBe('Houston')
    expect(projection.destinationCity).toBe('Dallas')
    expect(projection.viewCount).toBe(1)
  })

  it('increments viewCount on each successful resolution', async () => {
    const { rawToken } = await setUpLoadWithLink(72)

    const first = await resolvePublicTrackingLink(rawToken, freshIp())
    const second = await resolvePublicTrackingLink(rawToken, freshIp())
    expect(first.viewCount).toBe(1)
    expect(second.viewCount).toBe(2)
  })

  it('fails to resolve once expiresAt has passed', async () => {
    const { db, link, rawToken } = await setUpLoadWithLink(1)

    // Force the link into the past rather than waiting an hour — same effect
    // as a real TTL elapsing, since expiry is enforced at resolve time.
    await db.update(publicTrackingLinks, link.id, { expiresAt: new Date(Date.now() - 60_000) })

    await expect(resolvePublicTrackingLink(rawToken, freshIp())).rejects.toSatisfy(
      (error) => isAppError(error) && error.code === 'forbidden' && error.messageKey === 'tracking.errors.linkExpired',
    )
  })

  it('fails to resolve immediately after being revoked', async () => {
    const { db, link, rawToken } = await setUpLoadWithLink(72)

    // Confirm it resolves before revocation, then revoke and confirm it stops immediately.
    await resolvePublicTrackingLink(rawToken, freshIp())
    await revokePublicTrackingLink(db, link.id)

    await expect(resolvePublicTrackingLink(rawToken, freshIp())).rejects.toSatisfy(
      (error) => isAppError(error) && error.code === 'forbidden' && error.messageKey === 'tracking.errors.linkRevoked',
    )
  })

  it('never resolves an unknown or malformed token', async () => {
    await expect(resolvePublicTrackingLink('not-a-real-token', freshIp())).rejects.toSatisfy(
      (error) => isAppError(error) && error.code === 'not_found' && error.messageKey === 'tracking.errors.linkNotFound',
    )

    const { tenant } = await setUpLoadWithLink(72)
    await expect(resolvePublicTrackingLink(`${tenant.id}.wrong-secret`, freshIp())).rejects.toSatisfy(
      (error) => isAppError(error) && error.code === 'not_found' && error.messageKey === 'tracking.errors.linkNotFound',
    )
  })
})

describe('public tracking links — cross-tenant isolation', () => {
  it('a token minted for tenant A structurally cannot resolve tenant B\'s load, even with a guessed secret', async () => {
    const tenantA = await setUpLoadWithLink(72)
    const tenantB = await setUpLoadWithLink(72)

    // Splice tenant B's tenant id onto tenant A's secret — the only way an
    // attacker who somehow learned another tenant's id could try to pivot.
    const [, secretA] = tenantA.rawToken.split('.')
    const forgedToken = `${tenantB.tenant.id}.${secretA}`

    await expect(resolvePublicTrackingLink(forgedToken, freshIp())).rejects.toSatisfy(
      (error) => isAppError(error) && error.code === 'not_found' && error.messageKey === 'tracking.errors.linkNotFound',
    )

    // And, for completeness, each tenant's own real token still resolves only its own load.
    // Load numbers are per-tenant sequential (both fixtures' first load is "GD-1000"), so
    // sameness there proves nothing about isolation — what matters is that each token's fixed
    // tenant id is the one actually used to route the lookup, which the forged-token rejection
    // above already demonstrates; this just confirms the legitimate path still works for both.
    const projectionA = await resolvePublicTrackingLink(tenantA.rawToken, freshIp())
    const projectionB = await resolvePublicTrackingLink(tenantB.rawToken, freshIp())
    expect(projectionA.loadNumber).toBe(tenantA.load.loadNumber)
    expect(projectionB.loadNumber).toBe(tenantB.load.loadNumber)
    expect(tenantA.tenant.id).not.toBe(tenantB.tenant.id)
  })

  it('revoking a link in tenant A never affects an equivalent link in tenant B', async () => {
    const tenantA = await setUpLoadWithLink(72)
    const tenantB = await setUpLoadWithLink(72)

    await revokePublicTrackingLink(tenantA.db, tenantA.link.id)

    await expect(resolvePublicTrackingLink(tenantA.rawToken, freshIp())).rejects.toSatisfy(
      (error) => isAppError(error) && error.code === 'forbidden' && error.messageKey === 'tracking.errors.linkRevoked',
    )
    // Tenant B's link is untouched.
    const projectionB = await resolvePublicTrackingLink(tenantB.rawToken, freshIp())
    expect(projectionB.loadNumber).toBe(tenantB.load.loadNumber)
  })
})
