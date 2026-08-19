import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { documentVersions, documents, signatureRecords, signatureRequests } from '@/db/schema'
import { createTemplate } from '@/server/signatures/templates'
import {
  createSignatureRequest,
  resolveSignatureRequestByToken,
  signDocument,
  verifyIntegrity,
} from '@/server/signatures/service'
import { listAuditEventsForRequest } from '@/server/signatures/queries'
import { verifyChain } from '@/server/signatures/audit-chain'
import { getStorage } from '@/lib/storage'
import {
  DEFAULT_TOKEN_VALUES,
  createTestTenant,
  createTestUser,
  minimalTemplateFields,
  pngDataUrl,
} from './fixtures'

async function createSignedRequest() {
  const tenant = await createTestTenant()
  const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
  const db = tenantDb(tenant.id)

  const template = await createTemplate(db, minimalTemplateFields())

  const { request, rawToken } = await createSignatureRequest(db, {
    templateKey: template.templateKey,
    subjectType: 'tenant',
    subjectId: tenant.id,
    signerEmail: 'signer@example.test',
    locale: 'en',
    tokenValues: DEFAULT_TOKEN_VALUES,
    requestedByUserId: admin.id,
  })

  const resolved = await resolveSignatureRequestByToken(rawToken)
  expect(resolved.request.id).toBe(request.id)

  const { record } = await signDocument(db, {
    requestId: request.id,
    signerLegalName: 'Jordan Rivera',
    signerTitle: 'Owner',
    method: 'drawn',
    signatureDataUrl: pngDataUrl(),
    typedName: null,
    hasDrawnStrokes: true,
    consentAccepted: true,
    locale: 'en',
    ip: '203.0.113.5',
    userAgent: 'vitest-agent',
    actorUserId: null,
  })

  return { tenant, admin, db, template, request, rawToken, record }
}

describe('signature ceremony', () => {
  it('produces a record, two documents and a complete, valid event chain', async () => {
    const { db, tenant, request, record } = await createSignedRequest()

    expect(record.documentSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(record.signatureSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(record.integritySeal).toMatch(/^[a-f0-9]{64}$/)
    expect(record.signedDocumentId).toBeTruthy()
    expect(record.auditCertificateDocumentId).toBeTruthy()
    expect(record.signedDocumentId).not.toBe(record.auditCertificateDocumentId)

    const tenantDocuments = await db.findMany(documents, { where: eq(documents.ownerId, tenant.id) })
    expect(tenantDocuments).toHaveLength(2)

    const updatedRequest = await db.requireById(signatureRequests, request.id, 'signatureRequest')
    expect(updatedRequest.status).toBe('signed')

    const events = await listAuditEventsForRequest(db, request.id)
    const eventTypes = events.map((e) => e.eventType)
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        'requested',
        'consent_accepted',
        'signature_captured',
        'document_generated',
        'sealed',
      ]),
    )
    expect(verifyChain(events)).toEqual({ valid: true })
  })

  it('verifyIntegrity recomputes everything as valid immediately after signing', async () => {
    const { db, record } = await createSignedRequest()
    const result = await verifyIntegrity(db, record.id)
    expect(result).toEqual({ sealValid: true, documentHashValid: true, chainValid: true, brokenAtEventId: undefined })
  })

  it('mutating the stored signed PDF bytes makes documentHashValid false without affecting the seal check', async () => {
    const { db, record } = await createSignedRequest()

    const document = await db.requireById(documents, record.signedDocumentId!, 'document')
    const version = await db.requireById(documentVersions, document.currentVersionId!, 'documentVersion')

    await getStorage().put({
      key: version.storageKey,
      body: Buffer.from('this is not the original pdf bytes'),
      contentType: 'application/pdf',
    })

    const result = await verifyIntegrity(db, record.id)
    expect(result.documentHashValid).toBe(false)
    expect(result.sealValid).toBe(true)
    expect(result.chainValid).toBe(true)
  })

  it('the database rejects an UPDATE to signature_records.integrity_seal', async () => {
    const { db, record } = await createSignedRequest()
    await expect(db.update(signatureRecords, record.id, { integritySeal: 'f'.repeat(64) })).rejects.toThrow()
  })

  it('a signing token cannot be used twice', async () => {
    const { rawToken } = await createSignedRequest()
    await expect(resolveSignatureRequestByToken(rawToken)).rejects.toMatchObject({
      code: 'conflict',
      messageKey: 'signature.errors.alreadySigned',
    })
  })

  it('refuses to sign an already-signed request even called directly', async () => {
    const { db, request } = await createSignedRequest()
    await expect(
      signDocument(db, {
        requestId: request.id,
        signerLegalName: 'Someone Else',
        method: 'typed',
        signatureDataUrl: pngDataUrl(),
        typedName: 'Someone Else',
        hasDrawnStrokes: false,
        consentAccepted: true,
        locale: 'en',
        ip: '203.0.113.9',
        userAgent: 'vitest-agent',
      }),
    ).rejects.toMatchObject({ code: 'conflict', messageKey: 'signature.errors.alreadySigned' })
  })
})
