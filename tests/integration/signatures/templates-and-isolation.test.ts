import { describe, expect, it } from 'vitest'
import { tenantDb } from '@/db/tenant-db'
import {
  createNewTemplateVersion,
  createTemplate,
  findRequestsNeedingResignature,
} from '@/server/signatures/templates'
import { createSignatureRequest, resolveSignatureRequestByToken, signDocument } from '@/server/signatures/service'
import {
  DEFAULT_TOKEN_VALUES,
  createTestTenant,
  createTestUser,
  minimalTemplateFields,
  pngDataUrl,
} from './fixtures'

describe('template versioning and re-signature', () => {
  it('marks a signed request as needing re-signature once a newer version is published', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    const db = tenantDb(tenant.id)

    const template = await createTemplate(db, minimalTemplateFields())

    const { request } = await createSignatureRequest(db, {
      templateKey: template.templateKey,
      subjectType: 'tenant',
      subjectId: tenant.id,
      signerEmail: 'signer@example.test',
      locale: 'en',
      tokenValues: DEFAULT_TOKEN_VALUES,
      requestedByUserId: admin.id,
    })

    await signDocument(db, {
      requestId: request.id,
      signerLegalName: 'Jordan Rivera',
      method: 'typed',
      signatureDataUrl: pngDataUrl(),
      typedName: 'Jordan Rivera',
      hasDrawnStrokes: false,
      consentAccepted: true,
      locale: 'en',
      ip: '203.0.113.5',
      userAgent: 'vitest-agent',
    })

    // Not yet stale: only one version exists.
    expect(await findRequestsNeedingResignature(db, template.templateKey)).toHaveLength(0)

    await createNewTemplateVersion(db, template.templateKey, minimalTemplateFields({ templateKey: template.templateKey, titleEn: 'Notice of Assignment (updated)' }))

    const stale = await findRequestsNeedingResignature(db, template.templateKey)
    expect(stale.map((r) => r.id)).toContain(request.id)
  })
})

describe('cross-tenant token isolation', () => {
  it('cannot resolve a token forged with another tenant\'s id', async () => {
    const tenantA = await createTestTenant('Tenant A')
    const tenantB = await createTestTenant('Tenant B')
    const adminA = await createTestUser({ firstName: 'Ada', lastName: 'A' })
    const dbA = tenantDb(tenantA.id)

    const template = await createTemplate(dbA, minimalTemplateFields())
    const { rawToken } = await createSignatureRequest(dbA, {
      templateKey: template.templateKey,
      subjectType: 'tenant',
      subjectId: tenantA.id,
      signerEmail: 'signer@example.test',
      locale: 'en',
      tokenValues: DEFAULT_TOKEN_VALUES,
      requestedByUserId: adminA.id,
    })

    const secret = rawToken.split('.').slice(1).join('.')
    const forgedToken = `${tenantB.id}.${secret}`

    await expect(resolveSignatureRequestByToken(forgedToken)).rejects.toMatchObject({
      code: 'not_found',
      messageKey: 'signature.errors.linkInvalid',
    })

    // The genuine token still resolves fine within its own tenant.
    const resolved = await resolveSignatureRequestByToken(rawToken)
    expect(resolved.request.tenantId).toBe(tenantA.id)
  })
})
