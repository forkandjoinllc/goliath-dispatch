import { describe, expect, it } from 'vitest'
import { extractTemplateTokens, renderTemplateString, validateTemplateTokens } from '@/server/notifications/templates'

describe('extractTemplateTokens', () => {
  it('finds every distinct {{token}} in a string', () => {
    expect(extractTemplateTokens('Hi {{ownerName}}, {{documentType}} expires {{expirationDate}}.')).toEqual([
      'ownerName',
      'documentType',
      'expirationDate',
    ])
  })

  it('returns an empty list for a string with no tokens', () => {
    expect(extractTemplateTokens('No tokens here.')).toEqual([])
  })
})

describe('renderTemplateString', () => {
  it('substitutes known tokens', () => {
    expect(renderTemplateString('{{documentType}} expires soon', { documentType: 'COI' })).toBe(
      'COI expires soon',
    )
  })

  it('renders a known-but-unsupplied token as empty rather than leaving the placeholder', () => {
    expect(renderTemplateString('Reason: {{reason}}', {})).toBe('Reason: ')
  })
})

describe('validateTemplateTokens', () => {
  it('accepts a template using only tokens the event defines', () => {
    expect(() =>
      validateTemplateTokens('document.expiring', 'Reminder', '{{documentType}} expires {{expirationDate}}'),
    ).not.toThrow()
  })

  it('rejects a template that references a token outside the event catalog — never rendering {{loadNumber}} verbatim to a carrier', () => {
    expect(() => validateTemplateTokens('document.expiring', null, 'Load {{loadNumber}} needs attention')).toThrow()
  })

  it('rejects an unknown token even when it only appears in the subject line', () => {
    expect(() => validateTemplateTokens('lead.received', '{{invoiceNumber}}', 'A new lead arrived.')).toThrow()
  })
})
