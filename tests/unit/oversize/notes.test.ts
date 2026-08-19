import { describe, expect, it } from 'vitest'
import { decodeGuidanceNote, encodeGuidanceNote } from '@/server/oversize/notes'

describe('encodeGuidanceNote / decodeGuidanceNote', () => {
  it('round-trips a key with no params', () => {
    const encoded = encodeGuidanceNote('oversize.warnings.missingWidth')
    expect(encoded).toBe('oversize.warnings.missingWidth')
    expect(decodeGuidanceNote(encoded)).toEqual({ key: 'oversize.warnings.missingWidth', params: {} })
  })

  it('round-trips a key with params', () => {
    const encoded = encodeGuidanceNote('oversize.notes.permitRequired', { state: 'TX' })
    expect(decodeGuidanceNote(encoded)).toEqual({ key: 'oversize.notes.permitRequired', params: { state: 'TX' } })
  })

  it('round-trips multiple params, URL-encoding values that need it', () => {
    const encoded = encodeGuidanceNote('oversize.restrictions.curfew', { start: '20:00', end: '06:00 & beyond' })
    const decoded = decodeGuidanceNote(encoded)
    expect(decoded.key).toBe('oversize.restrictions.curfew')
    expect(decoded.params.start).toBe('20:00')
    expect(decoded.params.end).toBe('06:00 & beyond')
  })

  it('coerces numeric params to strings on encode and back on decode', () => {
    const encoded = encodeGuidanceNote('oversize.readiness.blocked', { count: 3 })
    expect(decodeGuidanceNote(encoded).params.count).toBe('3')
  })

  it('never emits a "?" for an empty params object, matching the no-params form', () => {
    const encoded = encodeGuidanceNote('oversize.warnings.noRoute', {})
    expect(encoded).toBe('oversize.warnings.noRoute')
  })
})
