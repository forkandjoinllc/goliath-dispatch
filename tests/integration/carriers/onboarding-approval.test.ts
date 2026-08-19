import { describe, expect, it } from 'vitest'
import { tenantDb, type TenantDb } from '@/db/tenant-db'
import { documents, carriers } from '@/db/schema'
import { approveOnboarding, createCarrier, transitionOnboarding } from '@/server/carriers/service'
import { createTestTenant, createTestUser, minimalCarrierInput, newDot } from './fixtures'

async function advanceToUnderReview(db: TenantDb, actor: { userId: string }, carrierId: string) {
  await transitionOnboarding(db, actor, carrierId, 'submitted')
  await transitionOnboarding(db, actor, carrierId, 'under_review')
}

describe('carrier onboarding approval', () => {
  it('is blocked while a required document is missing, and succeeds once it is uploaded and approved', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)
    const actor = { userId: admin.id }

    const { carrier } = await createCarrier(db, actor, minimalCarrierInput({ dotNumber: newDot() }))

    // FMCSA verification is out of scope for this test — mark it verified
    // directly so the only remaining blocker is the missing document set.
    await db.update(carriers, carrier.id, {
      fmcsaStatus: 'verified',
      fmcsaNextVerificationAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    await advanceToUnderReview(db, actor, carrier.id)

    // Not one required document has been uploaded yet — approval must refuse.
    await expect(approveOnboarding(db, actor, carrier.id)).rejects.toMatchObject({
      code: 'compliance_blocked',
      messageKey: 'onboarding.errors.blockedByCompliance',
    })

    // Upload and approve every required document (non-factoring checklist).
    const requiredTypes = ['certificate_of_authority', 'certificate_of_insurance', 'w9'] as const
    for (const documentType of requiredTypes) {
      await db.insert(documents, {
        documentType,
        ownerType: 'carrier',
        ownerId: carrier.id,
        reviewStatus: 'approved',
        isRequired: true,
      })
    }

    const onboarding = await approveOnboarding(db, actor, carrier.id)
    expect(onboarding.status).toBe('approved')

    const refreshedCarrier = await db.requireById(carriers, carrier.id, 'carrier')
    expect(refreshedCarrier.onboardingStatus).toBe('approved')
    expect(refreshedCarrier.approvedByUserId).toBe(admin.id)
  })
})
