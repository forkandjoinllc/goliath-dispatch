import { describe, expect, it } from 'vitest'
import { formatLoadNumber } from '@/server/loads/numbering'

describe('formatLoadNumber', () => {
  it('joins the tenant prefix and sequence with a hyphen', () => {
    expect(formatLoadNumber('GD', 1000)).toBe('GD-1000')
  })

  it('does not pad or otherwise reformat the sequence', () => {
    expect(formatLoadNumber('ACME', 7)).toBe('ACME-7')
  })

  it('supports a multi-character tenant prefix', () => {
    expect(formatLoadNumber('SUMMIT', 25341)).toBe('SUMMIT-25341')
  })
})
