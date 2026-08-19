import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { createCarrier } from '@/server/carriers/service'
import { minimalCarrierInput, newDot } from '../carriers/fixtures'
import { createTemplate } from '@/server/signatures/templates'
import { createSignatureRequest } from '@/server/signatures/service'
import { filterRequestsForScope, listSignatureRequestsForActor } from '@/server/signatures/queries'
import type { Actor, TenantPolicy } from '@/lib/permissions'
import { DEFAULT_TOKEN_VALUES, createTestTenant, createTestUser, minimalTemplateFields } from './fixtures'

function dispatcherActor(tenantId: string, userId: string, assignedCarrierIds: string[]): Actor {
  return {
    userId,
    email: 'dispatcher@example.test',
    firstName: 'Dee',
    lastName: 'Dispatcher',
    locale: 'en',
    timezone: 'America/Chicago',
    isPlatformSuperAdmin: false,
    tenantId,
    role: 'dispatcher',
    carrierId: null,
    driverId: null,
    assignments: { carrierIds: assignedCarrierIds, truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: null,
  }
}

/** A minimal tenant policy with no dispatcher-scope overrides. */
const DEFAULT_POLICY: TenantPolicy | null = null

describe('signature request scope enforcement', () => {
  it('a dispatcher only sees signature requests for carriers they are assigned to', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dispatcherUser = await createTestUser({ firstName: 'Dee', lastName: 'Dispatcher' })
    const db = tenantDb(tenant.id)

    const { carrier: assignedCarrier } = await createCarrier(
      db,
      { userId: admin.id },
      minimalCarrierInput({ dotNumber: newDot() }),
    )
    const { carrier: otherCarrier } = await createCarrier(
      db,
      { userId: admin.id },
      minimalCarrierInput({ dotNumber: newDot(), legalName: 'Other Carrier LLC' }),
    )

    const template = await createTemplate(db, minimalTemplateFields())

    const { request: assignedRequest } = await createSignatureRequest(db, {
      templateKey: template.templateKey,
      subjectType: 'carrier',
      subjectId: assignedCarrier.id,
      carrierId: assignedCarrier.id,
      signerEmail: 'signer-assigned@example.test',
      locale: 'en',
      tokenValues: DEFAULT_TOKEN_VALUES,
      requestedByUserId: admin.id,
    })
    const { request: otherRequest } = await createSignatureRequest(db, {
      templateKey: template.templateKey,
      subjectType: 'carrier',
      subjectId: otherCarrier.id,
      carrierId: otherCarrier.id,
      signerEmail: 'signer-other@example.test',
      locale: 'en',
      tokenValues: DEFAULT_TOKEN_VALUES,
      requestedByUserId: admin.id,
    })

    const dispatcher = dispatcherActor(tenant.id, dispatcherUser.id, [assignedCarrier.id])

    const visible = await listSignatureRequestsForActor(db, dispatcher, DEFAULT_POLICY)
    const visibleIds = visible.map((r) => r.id)
    expect(visibleIds).toContain(assignedRequest.id)
    expect(visibleIds).not.toContain(otherRequest.id)

    const filtered = filterRequestsForScope([assignedRequest, otherRequest], dispatcher, DEFAULT_POLICY)
    expect(filtered.map((r) => r.id)).toEqual([assignedRequest.id])
  })

  it('a dispatcher with no carrier assignments sees no signature requests at all', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dispatcherUser = await createTestUser({ firstName: 'Dee', lastName: 'Dispatcher' })
    const db = tenantDb(tenant.id)

    const { carrier } = await createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: newDot() }))
    const template = await createTemplate(db, minimalTemplateFields())
    await createSignatureRequest(db, {
      templateKey: template.templateKey,
      subjectType: 'carrier',
      subjectId: carrier.id,
      carrierId: carrier.id,
      signerEmail: 'signer@example.test',
      locale: 'en',
      tokenValues: DEFAULT_TOKEN_VALUES,
      requestedByUserId: admin.id,
    })

    const dispatcher = dispatcherActor(tenant.id, dispatcherUser.id, [])
    const visible = await listSignatureRequestsForActor(db, dispatcher, DEFAULT_POLICY)
    expect(visible).toHaveLength(0)
  })
})
