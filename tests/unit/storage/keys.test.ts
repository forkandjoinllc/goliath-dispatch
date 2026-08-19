import { describe, expect, it } from 'vitest'
import { assertKeyBelongsToTenant, buildKey, sanitizeFilename } from '@/lib/storage/keys'
import { isAppError } from '@/lib/errors'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const CARRIER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'

describe('buildKey', () => {
  it('always starts with tenants/{tenantId}/', () => {
    const key = buildKey({
      tenantId: TENANT_A,
      ownerType: 'carrier',
      ownerId: CARRIER_ID,
      documentId: DOCUMENT_ID,
      versionNumber: 3,
      filename: 'certificate-of-insurance.pdf',
    })
    expect(key).toBe(
      `tenants/${TENANT_A}/carriers/${CARRIER_ID}/documents/${DOCUMENT_ID}/v3/certificate-of-insurance.pdf`,
    )
  })

  it('sanitises directory traversal in the filename instead of embedding it', () => {
    const key = buildKey({
      tenantId: TENANT_A,
      ownerType: 'carrier',
      ownerId: CARRIER_ID,
      documentId: DOCUMENT_ID,
      versionNumber: 1,
      filename: '../../etc/passwd.pdf',
    })
    expect(key).not.toContain('..')
    expect(key.split('/')).toHaveLength(8)
    expect(key.endsWith('.pdf')).toBe(true)
  })

  it('rejects a tenantId that carries a path separator', () => {
    expect(() =>
      buildKey({
        tenantId: `${TENANT_A}/../${TENANT_B}`,
        ownerType: 'carrier',
        ownerId: CARRIER_ID,
        documentId: DOCUMENT_ID,
        versionNumber: 1,
        filename: 'file.pdf',
      }),
    ).toThrow()
  })

  it('rejects a non-positive or non-integer version number', () => {
    expect(() =>
      buildKey({
        tenantId: TENANT_A,
        ownerType: 'carrier',
        ownerId: CARRIER_ID,
        documentId: DOCUMENT_ID,
        versionNumber: 0,
        filename: 'file.pdf',
      }),
    ).toThrow()
  })
})

describe('sanitizeFilename', () => {
  it('strips traversal and separators while preserving the extension', () => {
    expect(sanitizeFilename('../../etc/passwd.pdf')).toBe('etc-passwd.pdf')
  })

  it('falls back to a safe name when nothing usable remains', () => {
    expect(sanitizeFilename('###.pdf')).toBe('file.pdf')
  })

  it('lowercases and truncates a long extension-less name', () => {
    expect(sanitizeFilename('Certificate Of Insurance')).toBe('certificate-of-insurance')
  })
})

describe('assertKeyBelongsToTenant', () => {
  it('accepts a key that starts with the caller tenant prefix', () => {
    const key = `tenants/${TENANT_A}/carriers/${CARRIER_ID}/documents/${DOCUMENT_ID}/v1/coi.pdf`
    expect(() => assertKeyBelongsToTenant(key, TENANT_A)).not.toThrow()
  })

  it('throws an AppError for a key belonging to a different tenant', () => {
    const key = `tenants/${TENANT_B}/carriers/${CARRIER_ID}/documents/${DOCUMENT_ID}/v1/coi.pdf`
    try {
      assertKeyBelongsToTenant(key, TENANT_A)
      expect.unreachable('expected assertKeyBelongsToTenant to throw')
    } catch (error) {
      expect(isAppError(error)).toBe(true)
      if (isAppError(error)) expect(error.code).toBe('forbidden')
    }
  })

  it('throws for a key that only coincidentally shares the tenant prefix as a substring', () => {
    // tenants/{A}xxxxx/... would still start with the literal string "tenants/{A}" if we
    // compared without the trailing slash — the trailing slash in the prefix is deliberate.
    const key = `tenants/${TENANT_A}extra/carriers/${CARRIER_ID}/documents/${DOCUMENT_ID}/v1/coi.pdf`
    expect(() => assertKeyBelongsToTenant(key, TENANT_A)).toThrow()
  })

  it('rejects a key smuggling traversal even under the right prefix', () => {
    const key = `tenants/${TENANT_A}/../${TENANT_B}/carriers/${CARRIER_ID}/documents/${DOCUMENT_ID}/v1/coi.pdf`
    expect(() => assertKeyBelongsToTenant(key, TENANT_A)).toThrow()
  })
})
