import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { signatureAuditEvents, signatureRequests, type SignatureAuditEvent } from '@/db/schema'
import { sha256Hex } from '@/lib/crypto'

/**
 * The ceremony hash chain.
 *
 * Every event recorded against a signature request links to the previous one:
 *
 *   eventHash = sha256Hex(previousEventHash ?? '' + canonicalEventPayload)
 *
 * `canonicalEventPayload` is `JSON.stringify` of a *fixed-order* tuple — never
 * of an object — so the hash cannot be affected by property enumeration
 * order, only by content. Reordering, editing or deleting a row breaks the
 * link for every event after it, which `verifyChain` detects deterministically.
 *
 * The chain is scoped per `requestId` (one ceremony, one chain). The
 * `signature_audit_events` table itself is append-only at the database level
 * (drizzle/custom/0001_audit_immutability.sql rejects UPDATE and DELETE), so
 * the only way to break the chain is to never have written a consistent one
 * in the first place — which is exactly what `verifyChain` proves did not
 * happen.
 */

export type SignatureEventType =
  | 'requested'
  | 'emailed'
  | 'opened'
  | 'viewed'
  | 'consent_shown'
  | 'consent_accepted'
  | 'signature_captured'
  | 'document_generated'
  | 'sealed'
  | 'emailed_copy'
  | 'declined'
  | 'voided'
  | 'superseded'
  | 'certificate_downloaded'

export interface AppendSignatureAuditEventInput {
  requestId: string
  recordId?: string | null
  eventType: SignatureEventType
  actorUserId?: string | null
  actorEmail?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  detail?: Record<string, unknown> | null
  /** Defaults to `new Date()`; overridable only for deterministic tests. */
  occurredAt?: Date
}

/**
 * The exact fields hashed into `eventHash`, in the fixed order the hash is
 * computed over. Exported so tests (and, if ever needed, an external
 * verifier) can reproduce the computation independently of this module.
 */
export interface CanonicalEventFields {
  requestId: string
  recordId: string | null
  eventType: string
  actorUserId: string | null
  actorEmail: string | null
  ipAddress: string | null
  userAgent: string | null
  detail: Record<string, unknown> | null
  occurredAtIso: string
}

/** `JSON.stringify` of a fixed-order tuple — see the module doc comment. */
export function canonicalEventPayload(fields: CanonicalEventFields): string {
  return JSON.stringify([
    'v1',
    fields.requestId,
    fields.recordId ?? '',
    fields.eventType,
    fields.actorUserId ?? '',
    fields.actorEmail ?? '',
    fields.ipAddress ?? '',
    fields.userAgent ?? '',
    fields.detail ?? {},
    fields.occurredAtIso,
  ])
}

export function computeEventHash(previousEventHash: string | null, fields: CanonicalEventFields): string {
  return sha256Hex(`${previousEventHash ?? ''}${canonicalEventPayload(fields)}`)
}

/**
 * Appends one event to a request's ceremony log.
 *
 * MUST be called from inside a `db.transaction()` — it locks the parent
 * `signature_requests` row with `SELECT … FOR UPDATE` before reading the
 * current chain tip, which is what makes "fetch the tip, then insert" race
 * free under concurrent appenders for the same request. The lock is released
 * when the enclosing transaction commits or rolls back.
 */
export async function appendSignatureAuditEvent(
  db: TenantDb,
  input: AppendSignatureAuditEventInput,
): Promise<SignatureAuditEvent> {
  await db.builderRequiringExplicitTenantPredicate
    .select({ id: signatureRequests.id })
    .from(signatureRequests)
    .where(and(eq(signatureRequests.tenantId, db.tenantId), eq(signatureRequests.id, input.requestId)))
    .for('update')

  const tip = await db.findFirst(signatureAuditEvents, {
    where: eq(signatureAuditEvents.requestId, input.requestId),
    orderBy: [desc(signatureAuditEvents.occurredAt), desc(signatureAuditEvents.id)],
  })

  const occurredAt = input.occurredAt ?? new Date()
  const fields: CanonicalEventFields = {
    requestId: input.requestId,
    recordId: input.recordId ?? null,
    eventType: input.eventType,
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    detail: input.detail ?? null,
    occurredAtIso: occurredAt.toISOString(),
  }

  const previousEventHash = tip?.eventHash ?? null
  const eventHash = computeEventHash(previousEventHash, fields)

  return db.insert(signatureAuditEvents, {
    requestId: input.requestId,
    recordId: input.recordId ?? null,
    eventType: input.eventType,
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    detail: input.detail ?? null,
    previousEventHash,
    eventHash,
    occurredAt,
  })
}

export interface ChainVerificationResult {
  valid: boolean
  /** id of the first event whose hash does not match its recomputed value, or is not linked to its predecessor. */
  brokenAtEventId?: string
  reason?: 'hash_mismatch' | 'link_mismatch' | 'empty'
}

/**
 * Re-walks a chronologically-ordered list of events (oldest first) and
 * recomputes every hash from its stored fields, verifying both that each
 * event's own hash matches its content and that it correctly links to the
 * previous event. Reordering the input, editing any field of any event, or
 * removing an event from the middle of the list is detected — the fields
 * always recompute a different hash than what a tampered chain expects.
 */
export function verifyChain(events: readonly SignatureAuditEvent[]): ChainVerificationResult {
  if (events.length === 0) return { valid: true }

  let previousEventHash: string | null = null
  for (const event of events) {
    const recomputed = computeEventHash(previousEventHash, {
      requestId: event.requestId,
      recordId: event.recordId,
      eventType: event.eventType,
      actorUserId: event.actorUserId,
      actorEmail: event.actorEmail,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      detail: event.detail ?? null,
      occurredAtIso: event.occurredAt.toISOString(),
    })

    if (event.previousEventHash !== previousEventHash) {
      return { valid: false, brokenAtEventId: event.id, reason: 'link_mismatch' }
    }
    if (recomputed !== event.eventHash) {
      return { valid: false, brokenAtEventId: event.id, reason: 'hash_mismatch' }
    }

    previousEventHash = event.eventHash
  }

  return { valid: true }
}
