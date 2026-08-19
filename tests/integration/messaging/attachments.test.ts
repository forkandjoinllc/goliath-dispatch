import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import { createCarrier } from '@/server/carriers/service'
import { addMessageAttachment, createConversation, sendMessage } from '@/server/messaging/service'
import { actorFor, createTestMembership, createTestTenant, createTestUser, minimalCarrierInput, newDot } from './fixtures'

// A minimal valid PDF (the malware/type sniffer looks at magic bytes only).
const PDF_BYTES = Buffer.from('%PDF-1.4\n%mock\n', 'utf8')

describe('message attachments', () => {
  it('inherits a tenant-scoped storage key', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    await createTestMembership(tenant.id, admin.id, 'admin')

    const { carrier } = await createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: newDot() }))
    const adminActor = actorFor(tenant.id, admin.id, { role: 'admin' })
    const { conversation } = await createConversation(db, adminActor, {
      kind: 'load',
      carrierId: carrier.id,
      participantUserIds: [],
      participantRoles: { [admin.id]: 'admin' },
    })
    const message = await sendMessage(db, adminActor, { conversationId: conversation.id, body: 'See attached.' })

    const attachment = await addMessageAttachment(db, adminActor, {
      conversationId: conversation.id,
      messageId: message.id,
      originalFilename: 'rate-confirmation.pdf',
      bytes: PDF_BYTES,
    })

    expect(attachment.storageKey.startsWith(`tenants/${tenant.id}/`)).toBe(true)
    expect(attachment.storageKey).toContain(conversation.id)
    expect(attachment.storageKey).toContain(message.id)
    expect(attachment.contentType).toBe('application/pdf')
  })

  it('rejects an attachment from a non-participant', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const outsider = await createTestUser({ firstName: 'Out', lastName: 'Sider' })
    const db = tenantDb(tenant.id)

    await createTestMembership(tenant.id, admin.id, 'admin')
    await createTestMembership(tenant.id, outsider.id, 'dispatcher')

    const { carrier } = await createCarrier(db, { userId: admin.id }, minimalCarrierInput({ dotNumber: newDot() }))
    const adminActor = actorFor(tenant.id, admin.id, { role: 'admin' })
    const { conversation } = await createConversation(db, adminActor, {
      kind: 'load',
      carrierId: carrier.id,
      participantUserIds: [],
      participantRoles: { [admin.id]: 'admin' },
    })
    const message = await sendMessage(db, adminActor, { conversationId: conversation.id, body: 'See attached.' })

    const outsiderActor = actorFor(tenant.id, outsider.id, { role: 'dispatcher' })
    await expect(
      addMessageAttachment(db, outsiderActor, {
        conversationId: conversation.id,
        messageId: message.id,
        originalFilename: 'rate-confirmation.pdf',
        bytes: PDF_BYTES,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
