import { describe, expect, it } from 'vitest'
import { desc, eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { equipmentVerifications } from '@/db/schema'
import { createTruck, transitionEquipmentStatus, uploadEquipmentMedia } from '@/server/equipment/service'
import { overrideEquipmentVerification } from '@/server/verification/equipment-verification'
import type { Actor } from '@/lib/permissions'
import { approveCoiWithVins, createTestCarrier, createTestTenant, createTestUser, goodVin } from './fixtures'

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a49444154789c6360000002000155e6f8fb0000000049454e44ae426082',
  'hex',
)

function fakeActor(userId: string): Actor {
  return {
    userId,
    email: 'admin@example.test',
    firstName: 'Ada',
    lastName: 'Admin',
    locale: 'en',
    timezone: 'America/Chicago',
    isPlatformSuperAdmin: false,
    tenantId: null,
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

async function addFourPhotos(db: ReturnType<typeof tenantDb>, actor: { userId: string }, truckId: string) {
  const angles = ['front', 'rear', 'driver_side', 'passenger_side'] as const
  for (const angle of angles) {
    await uploadEquipmentMedia(db, fakeActor(actor.userId), {
      equipmentType: 'truck',
      equipmentId: truckId,
      angle,
      originalFilename: `${angle}.png`,
      bytes: PNG_BYTES,
    })
  }
}

describe('equipment activation gate', () => {
  it('is blocked while the COI/VIN check fails, and succeeds once the VIN is on an approved COI plus four photos', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)
    const vin = goodVin()

    const truck = await createTruck(db, { userId: admin.id }, { carrierId: carrier.id, unitNumber: '500', vin })

    // No COI at all yet — activation must refuse.
    await expect(
      transitionEquipmentStatus(db, { userId: admin.id }, { equipmentType: 'truck', equipmentId: truck.id, toStatus: 'active' }),
    ).rejects.toMatchObject({ code: 'compliance_blocked', messageKey: 'equipment.errors.blockedByCompliance' })

    // Approve a COI, but with a *different* VIN — still blocked (vin_not_on_coi), and still short on photos.
    await approveCoiWithVins(db, carrier.id, ['1XPWD40X1ED215307'])
    await expect(
      transitionEquipmentStatus(db, { userId: admin.id }, { equipmentType: 'truck', equipmentId: truck.id, toStatus: 'active' }),
    ).rejects.toMatchObject({ code: 'compliance_blocked' })

    // Fix the COI to include this truck's VIN, then provide all four required photos —
    // each photo upload re-runs verification, so the last one reflects both fixes.
    await approveCoiWithVins(db, carrier.id, [vin])
    await addFourPhotos(db, { userId: admin.id }, truck.id)

    const activated = await transitionEquipmentStatus(db, { userId: admin.id }, {
      equipmentType: 'truck',
      equipmentId: truck.id,
      toStatus: 'active',
    })
    expect(activated.status).toBe('active')
  })

  it('succeeds via an Admin override even while the VIN does not match the COI', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)
    const vin = goodVin()

    const truck = await createTruck(db, { userId: admin.id }, { carrierId: carrier.id, unitNumber: '501', vin })
    await approveCoiWithVins(db, carrier.id, ['1XPWD40X1ED215307']) // does not include `vin`
    await addFourPhotos(db, { userId: admin.id }, truck.id)

    await expect(
      transitionEquipmentStatus(db, { userId: admin.id }, { equipmentType: 'truck', equipmentId: truck.id, toStatus: 'active' }),
    ).rejects.toMatchObject({ code: 'compliance_blocked' })

    const verification = await db.findFirst(equipmentVerifications, {
      where: eq(equipmentVerifications.equipmentId, truck.id),
      orderBy: desc(equipmentVerifications.createdAt),
    })
    expect(verification).not.toBeNull()

    await overrideEquipmentVerification(db, { userId: admin.id }, verification!.id, 'Confirmed with carrier by phone; COI will be updated next renewal.')

    const activated = await transitionEquipmentStatus(db, { userId: admin.id }, {
      equipmentType: 'truck',
      equipmentId: truck.id,
      toStatus: 'active',
    })
    expect(activated.status).toBe('active')
  })

  it('blocks activation with fewer than four photos even when the COI matches', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)
    const vin = goodVin()

    const truck = await createTruck(db, { userId: admin.id }, { carrierId: carrier.id, unitNumber: '502', vin })
    await approveCoiWithVins(db, carrier.id, [vin])

    // Only two of the four required photos.
    await uploadEquipmentMedia(db, fakeActor(admin.id), {
      equipmentType: 'truck',
      equipmentId: truck.id,
      angle: 'front',
      originalFilename: 'front.png',
      bytes: PNG_BYTES,
    })
    await uploadEquipmentMedia(db, fakeActor(admin.id), {
      equipmentType: 'truck',
      equipmentId: truck.id,
      angle: 'rear',
      originalFilename: 'rear.png',
      bytes: PNG_BYTES,
    })

    await expect(
      transitionEquipmentStatus(db, { userId: admin.id }, { equipmentType: 'truck', equipmentId: truck.id, toStatus: 'active' }),
    ).rejects.toMatchObject({ code: 'compliance_blocked' })
  })
})
