import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { createCarrier } from '@/server/carriers/service'
import { createConversation, markConversationRead, sendMessage } from '@/server/messaging/service'
import { getConversationDetail, unreadCountForUser } from '@/server/messaging/queries'
import {
  actorFor,
  assignDispatcherToCarrier,
  createTestMembership,
  createTestTenant,
  createTestUser,
  minimalCarrierInput,
  newDot,
} from './fixtures'

describe('messaging access control', () => {
  it('a non-participant cannot read a conversation', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dispatcherIn = await createTestUser({ firstName: 'In', lastName: 'Scope' })
    const dispatcherOut = await createTestUser({ firstName: 'Out', lastName: 'OfScope' })
    const db = tenantDb(tenant.id)

    await createTestMembership(tenant.id, admin.id, 'admin')
    await createTestMembership(tenant.id, dispatcherIn.id, 'dispatcher')
    await createTestMembership(tenant.id, dispatcherOut.id, 'dispatcher')

    const { carrier } = await createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: newDot() }))
    await assignDispatcherToCarrier(tenant.id, carrier.id, dispatcherIn.id, admin.id)

    const adminActor = actorFor(tenant.id, admin.id, { role: 'admin' })
    const { conversation } = await createConversation(db, adminActor, {
      kind: 'load',
      carrierId: carrier.id,
      participantUserIds: [dispatcherIn.id],
      participantRoles: { [admin.id]: 'admin', [dispatcherIn.id]: 'dispatcher' },
    })

    // The in-scope participant can read it.
    const detail = await getConversationDetail(db, conversation.id, dispatcherIn.id)
    expect(detail.conversation.id).toBe(conversation.id)

    // Someone never added as a participant cannot, even though they belong
    // to the same tenant.
    await expect(getConversationDetail(db, conversation.id, dispatcherOut.id)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('cross-tenant access fails even for a real conversation id', async () => {
    const tenantA = await createTestTenant('Tenant A')
    const tenantB = await createTestTenant('Tenant B')
    const adminA = await createTestUser({ firstName: 'Ada', lastName: 'A' })
    const someUserInB = await createTestUser({ firstName: 'Bea', lastName: 'B' })
    const dbA = tenantDb(tenantA.id)
    const dbB = tenantDb(tenantB.id)

    await createTestMembership(tenantA.id, adminA.id, 'admin')
    await createTestMembership(tenantB.id, someUserInB.id, 'admin')

    const { carrier } = await createCarrier(dbA, { userId: adminA.id }, minimalCarrierInput({ dotNumber: newDot() }))
    const adminActor = actorFor(tenantA.id, adminA.id, { role: 'admin' })
    const { conversation } = await createConversation(dbA, adminActor, {
      kind: 'load',
      carrierId: carrier.id,
      participantUserIds: [],
      participantRoles: { [adminA.id]: 'admin' },
    })

    // Tenant B's own TenantDb handle cannot see tenant A's conversation at
    // all — `requireById`/participant lookups are scoped to `dbB.tenantId`.
    await expect(getConversationDetail(dbB, conversation.id, someUserInB.id)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('unread counts update when the recipient reads the conversation', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const dispatcher = await createTestUser({ firstName: 'Dee', lastName: 'Dispatcher' })
    const db = tenantDb(tenant.id)

    await createTestMembership(tenant.id, admin.id, 'admin')
    await createTestMembership(tenant.id, dispatcher.id, 'dispatcher')

    const { carrier } = await createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: newDot() }))
    await assignDispatcherToCarrier(tenant.id, carrier.id, dispatcher.id, admin.id)

    const adminActor = actorFor(tenant.id, admin.id, { role: 'admin' })
    const { conversation } = await createConversation(db, adminActor, {
      kind: 'load',
      carrierId: carrier.id,
      participantUserIds: [dispatcher.id],
      participantRoles: { [admin.id]: 'admin', [dispatcher.id]: 'dispatcher' },
    })

    expect(await unreadCountForUser(db, dispatcher.id)).toBe(0)

    await sendMessage(db, adminActor, { conversationId: conversation.id, body: 'Please confirm pickup time.' })

    expect(await unreadCountForUser(db, dispatcher.id)).toBe(1)
    // The sender is never "unread" on their own message.
    expect(await unreadCountForUser(db, admin.id)).toBe(0)

    const dispatcherActor = actorFor(tenant.id, dispatcher.id, {
      role: 'dispatcher',
      assignments: { carrierIds: [carrier.id], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    })
    await markConversationRead(db, dispatcherActor, conversation.id)

    expect(await unreadCountForUser(db, dispatcher.id)).toBe(0)
  })
})
