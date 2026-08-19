import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { createCarrier, transitionOnboarding } from '@/server/carriers/service'
import { getCarrierWithOnboarding } from '@/server/carriers/queries'
import { createTestTenant, createTestUser, minimalCarrierInput, newDot } from './fixtures'

describe('onboarding state machine', () => {
  it('rejects a transition that skips required steps', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const { carrier } = await createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: newDot() }))

    // draft -> approved is not a legal transition; submitted/under_review must happen first.
    await expect(
      transitionOnboarding(db, { userId: admin.id }, carrier.id, 'approved'),
    ).rejects.toMatchObject({ code: 'conflict', messageKey: 'onboarding.errors.invalidTransition' })
  })

  it('rejects moving backwards from a terminal rejected state', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const { carrier } = await createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: newDot() }))

    await transitionOnboarding(db, { userId: admin.id }, carrier.id, 'submitted')
    await transitionOnboarding(db, { userId: admin.id }, carrier.id, 'under_review')
    await transitionOnboarding(db, { userId: admin.id }, carrier.id, 'rejected', {
      reason: 'Insurance certificate does not meet minimum coverage.',
    })

    await expect(
      transitionOnboarding(db, { userId: admin.id }, carrier.id, 'submitted'),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('requires a written reason to enter corrections_required or rejected', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const { carrier } = await createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: newDot() }))
    await transitionOnboarding(db, { userId: admin.id }, carrier.id, 'submitted')

    await expect(
      transitionOnboarding(db, { userId: admin.id }, carrier.id, 'corrections_required'),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('walks the legal path and records an event for each transition', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const { carrier } = await createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: newDot() }))

    await transitionOnboarding(db, { userId: admin.id }, carrier.id, 'submitted')
    await transitionOnboarding(db, { userId: admin.id }, carrier.id, 'under_review')
    await transitionOnboarding(db, { userId: admin.id }, carrier.id, 'corrections_required', {
      reason: 'Please resubmit a legible W-9.',
    })
    await transitionOnboarding(db, { userId: admin.id }, carrier.id, 'submitted')
    await transitionOnboarding(db, { userId: admin.id }, carrier.id, 'under_review')
    const finalOnboarding = await transitionOnboarding(db, { userId: admin.id }, carrier.id, 'approved')

    expect(finalOnboarding.status).toBe('approved')

    const { carrier: refreshed } = await getCarrierWithOnboarding(db, carrier.id)
    expect(refreshed.onboardingStatus).toBe('approved')
  })
})
