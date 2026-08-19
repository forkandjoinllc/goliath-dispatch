import 'server-only'
import { unsafeDb } from '@/db/client'
import { auditEvents } from '@/db/schema'
import type { Actor } from '@/lib/permissions'
import { logger, redact } from '@/lib/logger'

/**
 * The audit trail.
 *
 * Writes are append-only (enforced by a database trigger) and deliberately
 * best-effort at the call site: a failure to log must never roll back the
 * business action, but it is logged loudly so the gap is visible.
 *
 * Values are redacted through the same filter as application logs, so a diff
 * summary can be recorded without ever persisting an EIN or licence number.
 */

export type AuditAction = (typeof auditEvents.action.enumValues)[number]

export interface AuditInput {
  action: AuditAction
  entityType?: string
  entityId?: string | null
  entityLabel?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  /** Required by policy for overrides, impersonation, deletion, legal holds. */
  reason?: string | null
  tenantId?: string | null
  metadata?: Record<string, unknown>
}

export interface AuditRequestContext {
  ipAddress: string | null
  userAgent: string | null
  requestId: string
}

const REASON_REQUIRED: AuditAction[] = [
  'impersonation.started',
  'verification.override',
  'document.deleted',
  'legal_hold.applied',
  'legal_hold.released',
  'retention.purged',
  'invoice.status_changed',
  'load.cancelled',
]

/** Fields that must never appear in a before/after summary, even redacted. */
const NEVER_LOG = new Set([
  'passwordHash',
  'einEncrypted',
  'taxIdEncrypted',
  'licenseNumberEncrypted',
  'secretEncrypted',
  'credentialsEncrypted',
  'tokenHash',
  'accessTokenHash',
  'recoveryCodeHashes',
  'signatureStorageKey',
])

function summarize(values: Record<string, unknown> | null | undefined) {
  if (!values) return null
  const filtered = Object.fromEntries(
    Object.entries(values).filter(([key]) => !NEVER_LOG.has(key)),
  )
  return redact(filtered) as Record<string, unknown>
}

export async function recordAudit(
  actor: Actor | null,
  request: AuditRequestContext,
  input: AuditInput,
): Promise<void> {
  if (REASON_REQUIRED.includes(input.action) && !input.reason) {
    throw new Error(`Audit action "${input.action}" requires a reason`)
  }

  try {
    await unsafeDb.insert(auditEvents).values({
      tenantId: input.tenantId ?? actor?.tenantId ?? null,
      actorUserId: actor?.impersonation?.actorUserId ?? actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
      effectiveUserId: actor?.userId ?? null,
      impersonationSessionId: actor?.impersonation?.impersonationSessionId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      entityLabel: input.entityLabel ?? null,
      beforeSummary: summarize(input.before),
      afterSummary: summarize({ ...(input.after ?? {}), ...(input.metadata ?? {}) }),
      reason: input.reason ?? null,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      requestId: request.requestId,
    })
  } catch (error) {
    logger.error('Failed to write audit event', {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? undefined,
      tenantId: input.tenantId ?? actor?.tenantId ?? undefined,
      error,
    })
  }
}

/**
 * Produces a compact field-level diff for the audit summary. Only changed keys
 * are recorded, which keeps the trail readable and the table small.
 */
export function diffRecords<T extends Record<string, unknown>>(
  before: T | null,
  after: Partial<T>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {}
  const changedAfter: Record<string, unknown> = {}

  for (const [key, nextValue] of Object.entries(after)) {
    const previous = before?.[key]
    const changed =
      previous instanceof Date && nextValue instanceof Date
        ? previous.getTime() !== nextValue.getTime()
        : JSON.stringify(previous) !== JSON.stringify(nextValue)
    if (changed) {
      changedBefore[key] = previous ?? null
      changedAfter[key] = nextValue ?? null
    }
  }

  return { before: changedBefore, after: changedAfter }
}
