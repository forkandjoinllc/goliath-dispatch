import { describe, expect, it } from 'vitest'
import { computeEventHash, verifyChain, type CanonicalEventFields } from '@/server/signatures/audit-chain'
import type { SignatureAuditEvent } from '@/db/schema'

let counter = 0
function uuid(): string {
  counter += 1
  return `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`
}

function makeChain(eventTypes: string[]): SignatureAuditEvent[] {
  const requestId = uuid()
  let previousEventHash: string | null = null
  const events: SignatureAuditEvent[] = []

  eventTypes.forEach((eventType, index) => {
    const occurredAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index))
    const fields: CanonicalEventFields = {
      requestId,
      recordId: null,
      eventType,
      actorUserId: null,
      actorEmail: null,
      ipAddress: '203.0.113.1',
      userAgent: 'test-agent',
      detail: null,
      occurredAtIso: occurredAt.toISOString(),
    }
    const eventHash = computeEventHash(previousEventHash, fields)
    events.push({
      id: uuid(),
      tenantId: 'tenant-1',
      requestId,
      recordId: null,
      eventType,
      actorUserId: null,
      actorEmail: null,
      ipAddress: '203.0.113.1',
      userAgent: 'test-agent',
      detail: null,
      previousEventHash,
      eventHash,
      occurredAt,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      archivedAt: null,
      purgeEligibleAt: null,
      legalHold: false,
    } as SignatureAuditEvent)
    previousEventHash = eventHash
  })

  return events
}

describe('verifyChain', () => {
  it('validates an untouched chain', () => {
    const events = makeChain(['requested', 'emailed', 'viewed', 'sealed'])
    expect(verifyChain(events)).toEqual({ valid: true })
  })

  it('is valid for an empty chain', () => {
    expect(verifyChain([])).toEqual({ valid: true })
  })

  it('detects an edited event', () => {
    const events = makeChain(['requested', 'emailed', 'viewed'])
    const tampered = events.map((e, i) => (i === 1 ? { ...e, actorEmail: 'attacker@example.test' } : e))
    const result = verifyChain(tampered)
    expect(result.valid).toBe(false)
    expect(result.brokenAtEventId).toBe(tampered[1]!.id)
    expect(result.reason).toBe('hash_mismatch')
  })

  it('detects a deleted (removed) event', () => {
    const events = makeChain(['requested', 'emailed', 'viewed', 'sealed'])
    const withGap = [events[0]!, events[2]!, events[3]!]
    const result = verifyChain(withGap)
    expect(result.valid).toBe(false)
    // The event after the gap no longer links to what is now its immediate predecessor.
    expect(result.brokenAtEventId).toBe(events[2]!.id)
    expect(result.reason).toBe('link_mismatch')
  })

  it('detects reordered events', () => {
    const events = makeChain(['requested', 'emailed', 'viewed'])
    const reordered = [events[0]!, events[2]!, events[1]!]
    const result = verifyChain(reordered)
    expect(result.valid).toBe(false)
  })
})
