import { describe, expect, it } from 'vitest'
import { canonicalizeTemplate, computeTemplateContentHash, renderTemplate } from '@/server/signatures/templates'
import type { SignatureTemplate } from '@/db/schema'

const baseFields = {
  titleEn: 'Notice of Assignment',
  titleEs: 'Aviso de Cesión',
  bodyEn: 'Effective {{effectiveDate}}, {{carrierLegalName}} assigns payment to {{customerName}}.',
  bodyEs: 'A partir del {{effectiveDate}}, {{carrierLegalName}} cede el pago a {{customerName}}.',
  consentCopyEn: 'By signing you agree.',
  consentCopyEs: 'Al firmar usted acepta.',
  requiredTokens: ['effectiveDate', 'carrierLegalName', 'customerName'],
}

function template(overrides: Partial<SignatureTemplate> = {}): SignatureTemplate {
  return {
    id: 'template-id',
    tenantId: 'tenant-id',
    templateKey: 'notice_of_assignment',
    version: 1,
    titleEn: baseFields.titleEn,
    titleEs: baseFields.titleEs,
    bodyEn: baseFields.bodyEn,
    bodyEs: baseFields.bodyEs,
    consentCopyEn: baseFields.consentCopyEn,
    consentCopyEs: baseFields.consentCopyEs,
    contentHash: 'irrelevant-for-render',
    requiredTokens: baseFields.requiredTokens,
    active: true,
    effectiveFrom: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    archivedAt: null,
    purgeEligibleAt: null,
    legalHold: false,
    ...overrides,
  } as SignatureTemplate
}

describe('canonicalizeTemplate', () => {
  it('is stable regardless of requiredTokens order', () => {
    const a = canonicalizeTemplate({ ...baseFields, requiredTokens: ['a', 'b', 'c'] })
    const b = canonicalizeTemplate({ ...baseFields, requiredTokens: ['c', 'a', 'b'] })
    expect(a).toBe(b)
  })

  it('changes when any content field changes', () => {
    const base = canonicalizeTemplate(baseFields)
    expect(canonicalizeTemplate({ ...baseFields, titleEn: 'Different title' })).not.toBe(base)
    expect(canonicalizeTemplate({ ...baseFields, titleEs: 'Título diferente' })).not.toBe(base)
    expect(canonicalizeTemplate({ ...baseFields, bodyEn: 'Different body' })).not.toBe(base)
    expect(canonicalizeTemplate({ ...baseFields, bodyEs: 'Cuerpo diferente' })).not.toBe(base)
    expect(canonicalizeTemplate({ ...baseFields, consentCopyEn: 'Different consent' })).not.toBe(base)
    expect(canonicalizeTemplate({ ...baseFields, consentCopyEs: 'Consentimiento diferente' })).not.toBe(base)
    expect(canonicalizeTemplate({ ...baseFields, requiredTokens: ['effectiveDate'] })).not.toBe(base)
  })

  it('produces a reproducible sha256 hash', () => {
    const hash1 = computeTemplateContentHash(baseFields)
    const hash2 = computeTemplateContentHash(baseFields)
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('renderTemplate', () => {
  it('substitutes tokens per locale', () => {
    const rendered = renderTemplate(
      template(),
      { effectiveDate: '2026-01-01', carrierLegalName: 'Summit Heavy Haul LLC', customerName: 'Acme Corp' },
      'en',
    )
    expect(rendered.title).toBe('Notice of Assignment')
    expect(rendered.body).toBe('Effective 2026-01-01, Summit Heavy Haul LLC assigns payment to Acme Corp.')
  })

  it('renders the Spanish locale from the Spanish fields', () => {
    const rendered = renderTemplate(
      template(),
      { effectiveDate: '2026-01-01', carrierLegalName: 'Summit Heavy Haul LLC', customerName: 'Acme Corp' },
      'es',
    )
    expect(rendered.title).toBe('Aviso de Cesión')
    expect(rendered.body).toContain('A partir del 2026-01-01')
  })

  it('throws when a required token is missing rather than rendering blank', () => {
    expect(() =>
      renderTemplate(template(), { effectiveDate: '2026-01-01', carrierLegalName: 'Summit Heavy Haul LLC' }, 'en'),
    ).toThrow()
  })

  it('throws when a required token is present but empty/whitespace', () => {
    expect(() =>
      renderTemplate(
        template(),
        { effectiveDate: '2026-01-01', carrierLegalName: 'Summit Heavy Haul LLC', customerName: '   ' },
        'en',
      ),
    ).toThrow()
  })
})
