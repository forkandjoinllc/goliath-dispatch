import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { globalSearch } from '@/server/search/search'
import { createCarrier } from '@/server/carriers/service'
import type { Actor } from '@/lib/permissions'
import { createTestTenant, createTestUser } from './fixtures'

function adminActor(tenantId: string, userId: string): Actor {
  return {
    userId,
    email: 'admin@example.test',
    firstName: 'Ada',
    lastName: 'Admin',
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
  }
}

/** A minimal, valid `createCarrier` input, distinctive by legal name and DOT. */
function carrierInput(overrides: Partial<Parameters<typeof createCarrier>[2]> = {}) {
  return {
    legalName: 'Placeholder LLC',
    dotNumber: String(Math.floor(1_000_000 + Math.random() * 8_000_000)),
    ein: '123456789',
    contactFirstName: 'Jordan',
    contactLastName: 'Rivera',
    email: 'ops@example.test',
    phone: '2145550100',
    preferredLocale: 'en' as const,
    mailingSameAsPhysical: true,
    usesFactoring: false,
    ...overrides,
  }
}

describe('global search — tenant isolation', () => {
  it('never returns another tenant’s matching carrier, even when the search term matches both', async () => {
    const tenantA = await createTestTenant({ name: 'Tenant A Dispatch' })
    const tenantB = await createTestTenant({ name: 'Tenant B Dispatch' })
    const { user: adminA } = await createTestUser({ firstName: 'Ada', lastName: 'AdminA' })
    const { user: adminB } = await createTestUser({ firstName: 'Bea', lastName: 'AdminB' })

    const dbA = tenantDb(tenantA.id)
    const dbB = tenantDb(tenantB.id)

    const { carrier: carrierA } = await createCarrier(
      dbA,
      { userId: adminA.id },
      carrierInput({ legalName: 'Summit Heavy Haul LLC' }),
    )
    const { carrier: carrierB } = await createCarrier(
      dbB,
      { userId: adminB.id },
      carrierInput({ legalName: 'Summit Heavy Haul LLC' }),
    )

    // Both carriers share the exact same searchable name, in two different
    // tenants — the only thing that should separate the results is scoping.
    const actorA = adminActor(tenantA.id, adminA.id)
    const results = await globalSearch(actorA, 'Summit Heavy Haul')

    const carrierGroup = results.carriers ?? []
    const ids = carrierGroup.map((item) => item.id)

    expect(ids).toContain(carrierA.id)
    expect(ids).not.toContain(carrierB.id)
    expect(carrierGroup).toHaveLength(1)
  })

  it('returns no results at all for a tenant that has no matching records, even though another tenant does', async () => {
    const tenantA = await createTestTenant({ name: 'Tenant With Match' })
    const tenantB = await createTestTenant({ name: 'Tenant Without Match' })
    const { user: adminA } = await createTestUser()
    const { user: adminB } = await createTestUser()

    await createCarrier(
      tenantDb(tenantA.id),
      { userId: adminA.id },
      carrierInput({ legalName: 'Unique Freight Solutions LLC' }),
    )

    const actorB = adminActor(tenantB.id, adminB.id)
    const results = await globalSearch(actorB, 'Unique Freight Solutions')

    expect(results.carriers ?? []).toHaveLength(0)
  })

  it('returns nothing for a query shorter than the minimum length, without querying the database', async () => {
    const tenant = await createTestTenant()
    const { user: admin } = await createTestUser()
    const actor = adminActor(tenant.id, admin.id)

    const results = await globalSearch(actor, 'a')
    expect(results).toEqual({})
  })
})
