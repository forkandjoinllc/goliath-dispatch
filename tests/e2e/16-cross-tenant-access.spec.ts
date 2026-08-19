import { test, expect } from '@playwright/test'
import { login, TENANT_A, TENANT_B } from './support/auth'
import { waitForHydration } from './support/wait'
import { createLoad } from './support/loads'
import { createCustomer } from './support/customer'
import { db, eq, schema, getTenantBySlug } from './support/db'

/**
 * Flow 17 — cross-tenant access fails closed.
 *
 * Every tenant-scoped query in this app goes through `TenantDb`
 * (`ctx.db` in a `defineAction`/`loadFor` handler), which filters by the
 * actor's own `tenantId` automatically — so a resource id belonging to a
 * *different* tenant simply doesn't exist from that handle's point of view.
 * A page or action reaching for it via `requireById` throws an uncaught
 * `AppError('not_found')`, which (nothing in these routes catches it)
 * surfaces as the app's generic `error.tsx` boundary ("Something went
 * wrong") — the exact same fails-closed shape
 * `12-driver-pod-upload.spec.ts` already exercises for an unassigned
 * driver. This spec exercises the same mechanism for cross-TENANT access
 * specifically, on both a carrier and a load, in both directions, plus:
 *  - the seed data's own DOT-number collision (Tenant A's "Rio Grande
 *    Freight Solutions" and Tenant B's "Del Rio Cross-Border Freight" are
 *    seeded with the identical DOT number) — proving the *same* DOT
 *    resolves each tenant to its own, entirely different carrier record,
 *    not a shared/leaked one;
 *  - that tenant-scoped search (the "Assign carrier" combobox) never
 *    surfaces another tenant's carrier as a result, even when searched by
 *    its exact legal name.
 */
test.describe('Cross-tenant access fails closed', () => {
  test('a resource id from another tenant is refused, even when the two tenants share a DOT number', async ({ page }) => {
    test.setTimeout(90_000)

    const tenantA = await getTenantBySlug(TENANT_A.slug)
    const tenantB = await getTenantBySlug(TENANT_B.slug)
    expect(tenantA).toBeTruthy()
    expect(tenantB).toBeTruthy()

    const carriersA = await db.query.carriers.findMany({ where: eq(schema.carriers.tenantId, tenantA!.id) })
    const carriersB = await db.query.carriers.findMany({ where: eq(schema.carriers.tenantId, tenantB!.id) })
    // The seed can produce more than one cross-tenant DOT collision, some
    // incidentally sharing a legal name too (Postgres gives no row-order
    // guarantee without `ORDER BY`, so which collision comes back "first"
    // isn't stable run to run) — this test specifically wants a DOT shared
    // by two carriers with DIFFERENT names, to prove the DOT alone doesn't
    // determine identity.
    const dotSetA = new Map(carriersA.map((c) => [c.dotNumber, c]))
    const collisionB = carriersB.find((c) => {
      const match = dotSetA.get(c.dotNumber)
      return match && match.legalName !== c.legalName
    })
    expect(collisionB, 'expected the seed to contain a cross-tenant DOT-number collision with differing legal names').toBeTruthy()
    const collisionA = dotSetA.get(collisionB!.dotNumber)!
    expect(collisionA.id).not.toBe(collisionB!.id)
    expect(collisionA.legalName).not.toBe(collisionB!.legalName)

    // ── The same DOT number resolves each tenant to its OWN carrier. ──
    await login(page, TENANT_A.admin.email)
    await page.goto(`/en/app/carriers/${collisionA.id}`)
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: collisionA.legalName, exact: true })).toBeVisible()

    await login(page, TENANT_B.admin.email)
    await page.goto(`/en/app/carriers/${collisionB!.id}`)
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: collisionB!.legalName, exact: true })).toBeVisible()

    // ── Tenant B admin cannot reach Tenant A's carrier record by id, even
    // though both carriers share a DOT number. ──
    await page.goto(`/en/app/carriers/${collisionA.id}`)
    await waitForHydration(page)
    await expect(page.getByText(/something went wrong/i)).toBeVisible()
    await expect(page.getByText(collisionA.legalName)).not.toBeVisible()

    // ── Symmetric: Tenant A admin cannot reach Tenant B's carrier. ──
    await login(page, TENANT_A.admin.email)
    await page.goto(`/en/app/carriers/${collisionB!.id}`)
    await waitForHydration(page)
    await expect(page.getByText(/something went wrong/i)).toBeVisible()
    await expect(page.getByText(collisionB!.legalName)).not.toBeVisible()

    // ── Same fails-closed shape for a LOAD id across tenants. ──
    const stamp = Date.now()
    const customerName = `Cross Tenant Shipper ${stamp}`
    await createCustomer(page, { companyName: customerName })
    const loadIdA = await createLoad(page, {
      customerName,
      stops: [
        { stopType: 'pickup', facilityName: 'Origin DC', line1: '100 Dock Rd', city: 'Waco', state: 'TX', postalCode: '76701' },
        { stopType: 'delivery', facilityName: 'Destination DC', line1: '200 Depot Ave', city: 'Tyler', state: 'TX', postalCode: '75701' },
      ],
    })

    await login(page, TENANT_B.admin.email)
    await page.goto(`/en/app/loads/${loadIdA}`)
    await waitForHydration(page)
    await expect(page.getByText(/something went wrong/i)).toBeVisible()

    const loadB = await db.query.loads.findFirst({ where: eq(schema.loads.tenantId, tenantB!.id) })
    expect(loadB).toBeTruthy()
    await login(page, TENANT_A.admin.email)
    await page.goto(`/en/app/loads/${loadB!.id}`)
    await waitForHydration(page)
    await expect(page.getByText(/something went wrong/i)).toBeVisible()

    // ── Tenant-scoped search never surfaces another tenant's carrier, even
    // searched by its exact legal name. ──
    await page.goto(`/en/app/loads/${loadIdA}`)
    await waitForHydration(page)
    await page.getByRole('tab', { name: /assignments/i }).click()
    await page.getByPlaceholder('Carrier').fill(collisionB!.legalName.slice(0, 12))
    await expect(page.getByRole('option', { name: collisionB!.legalName })).toHaveCount(0)
    await expect(page.getByRole('option', { name: collisionA.legalName })).toHaveCount(0)
  })
})
