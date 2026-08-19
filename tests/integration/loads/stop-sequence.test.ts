import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { loadStops } from '@/db/schema'
import { addStop, removeStop, reorderStops } from '@/server/loads/service'
import { createTestCustomer, createTestLoad, createTestTenant, createTestUser } from './fixtures'

describe('stop sequence integrity', () => {
  it('addStop inserted mid-route shifts later stops up by one, with no gaps or collisions', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = { userId: admin.id, role: 'admin' as const }
    const customer = await createTestCustomer(db, { userId: admin.id })

    const { load, stops } = await createTestLoad(db, actor, { customerId: customer.id })
    expect(stops.map((s) => s.sequence)).toEqual([1, 2])
    const [pickup, delivery] = stops

    const inserted = await addStop(db, actor, {
      loadId: load.id,
      stopType: 'delivery',
      sequence: 2,
      city: 'Waco',
      state: 'TX',
      postalCode: '76701',
      appointmentType: 'fcfs',
    })
    expect(inserted.sequence).toBe(2)

    const all = await db.findMany(loadStops, { where: eq(loadStops.loadId, load.id), orderBy: asc(loadStops.sequence) })
    expect(all.map((s) => s.sequence)).toEqual([1, 2, 3])
    expect(all.map((s) => s.id)).toEqual([pickup!.id, inserted.id, delivery!.id])
  })

  it('reorderStops renumbers to exactly match the requested order without violating the unique index', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = { userId: admin.id, role: 'admin' as const }
    const customer = await createTestCustomer(db, { userId: admin.id })

    const { load, stops } = await createTestLoad(db, actor, { customerId: customer.id })
    const [pickup, delivery] = stops

    const reversed = await reorderStops(db, actor, load.id, [delivery!.id, pickup!.id])
    expect(reversed.map((s) => s.id)).toEqual([delivery!.id, pickup!.id])
    expect(reversed.map((s) => s.sequence)).toEqual([1, 2])

    const persisted = await db.findMany(loadStops, { where: eq(loadStops.loadId, load.id), orderBy: asc(loadStops.sequence) })
    expect(persisted.map((s) => s.id)).toEqual([delivery!.id, pickup!.id])
  })

  it('reorderStops rejects a set that does not exactly match the load\'s current stops', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = { userId: admin.id, role: 'admin' as const }
    const customer = await createTestCustomer(db, { userId: admin.id })

    const { load, stops } = await createTestLoad(db, actor, { customerId: customer.id })

    await expect(reorderStops(db, actor, load.id, [stops[0]!.id])).rejects.toMatchObject({
      messageKey: 'load.errors.stopSequenceMismatch',
    })
  })

  it('removeStop closes the gap left behind so sequences stay contiguous from 1', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = { userId: admin.id, role: 'admin' as const }
    const customer = await createTestCustomer(db, { userId: admin.id })

    const { load, stops } = await createTestLoad(db, actor, { customerId: customer.id })
    const middle = await addStop(db, actor, {
      loadId: load.id,
      stopType: 'delivery',
      sequence: 2,
      city: 'Waco',
      state: 'TX',
      postalCode: '76701',
      appointmentType: 'fcfs',
    })
    const [pickup, , delivery] = [stops[0]!, middle, stops[1]!]

    const remaining = await removeStop(db, actor, load.id, middle.id)
    expect(remaining.map((s) => s.id)).toEqual([pickup.id, delivery.id])
    expect(remaining.map((s) => s.sequence)).toEqual([1, 2])

    const persisted = await db.findMany(loadStops, { where: eq(loadStops.loadId, load.id), orderBy: asc(loadStops.sequence) })
    expect(persisted).toHaveLength(2)
    expect(persisted.map((s) => s.sequence)).toEqual([1, 2])
  })
})
