import { describe, expect, it } from 'vitest'
import { buildDedupeKey } from '@/server/notifications/dispatch'

describe('buildDedupeKey', () => {
  it('is stable for the same event/subject/channel, so a repeat sweep sees the same key', () => {
    const first = buildDedupeKey('document.expiring', { type: 'document', id: 'doc-1' }, 'email')
    const second = buildDedupeKey('document.expiring', { type: 'document', id: 'doc-1' }, 'email')
    expect(first).toBe(second)
  })

  it('is stable across suffixes representing the same occurrence (e.g. the same expiration date)', () => {
    const first = buildDedupeKey('document.expiring', { type: 'document', id: 'doc-1' }, 'email', '2026-09-01')
    const second = buildDedupeKey('document.expiring', { type: 'document', id: 'doc-1' }, 'email', '2026-09-01')
    expect(first).toBe(second)
  })

  it('differs for a different subject', () => {
    const first = buildDedupeKey('document.expiring', { type: 'document', id: 'doc-1' }, 'email')
    const second = buildDedupeKey('document.expiring', { type: 'document', id: 'doc-2' }, 'email')
    expect(first).not.toBe(second)
  })

  it('differs for a different event on the same subject', () => {
    const first = buildDedupeKey('document.expiring', { type: 'document', id: 'doc-1' }, 'email')
    const second = buildDedupeKey('document.expired', { type: 'document', id: 'doc-1' }, 'email')
    expect(first).not.toBe(second)
  })

  it('differs for a different channel', () => {
    const first = buildDedupeKey('document.expiring', { type: 'document', id: 'doc-1' }, 'email')
    const second = buildDedupeKey('document.expiring', { type: 'document', id: 'doc-1' }, 'sms')
    expect(first).not.toBe(second)
  })

  it('differs when the suffix (occurrence) changes, e.g. a document re-uploaded with a new expiration date', () => {
    const first = buildDedupeKey('document.expiring', { type: 'document', id: 'doc-1' }, 'email', '2026-09-01')
    const second = buildDedupeKey('document.expiring', { type: 'document', id: 'doc-1' }, 'email', '2026-10-01')
    expect(first).not.toBe(second)
  })
})
