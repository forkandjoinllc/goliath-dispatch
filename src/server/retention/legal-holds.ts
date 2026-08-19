import 'server-only'
import { eq, isNull, notInArray, sql } from 'drizzle-orm'
import { legalHolds, type LegalHold } from '@/db/schema'
import type { TenantDb } from '@/db/tenant-db'
import type { Actor } from '@/lib/permissions'
import type { AuditRequestContext } from '@/lib/audit'
import { recordAudit } from '@/lib/audit'
import { validationFailed, notFound } from '@/lib/errors'
import { classifyEntity, RETENTION_ENTITY_TYPES } from './policy'

/**
 * Legal holds.
 *
 * A hold can cover the whole tenant, a single entity type, or one specific
 * record; the `reason` is mandatory and every apply/release is audited.
 * `applyLegalHold` sets `legal_hold = true` on every row the hold covers
 * (where the table has the column — see `policy.ts`). `releaseLegalHold`
 * clears that flag only on rows no *other* active hold still covers, which
 * is why release has to recompute coverage from the remaining active holds
 * rather than simply flipping the flag back.
 */

const MIN_REASON_LENGTH = 10

export type LegalHoldScopeType = 'tenant' | 'entity_type' | 'record'

export interface ApplyLegalHoldInput {
  name: string
  reason: string
  scopeType: LegalHoldScopeType
  entityType?: string
  entityId?: string
  matterReference?: string
}

function assertValidScope(input: ApplyLegalHoldInput): void {
  if (input.reason.trim().length < MIN_REASON_LENGTH) {
    throw validationFailed('validation.minLength', { min: MIN_REASON_LENGTH })
  }
  if (input.scopeType === 'tenant') return
  if (!input.entityType || !RETENTION_ENTITY_TYPES.includes(input.entityType)) {
    throw validationFailed('settings.retention.errors.unknownEntityType', { entityType: input.entityType ?? '' })
  }
  if (input.scopeType === 'record' && !input.entityId) {
    throw validationFailed('settings.retention.errors.recordIdRequired')
  }
}

export async function applyLegalHold(
  db: TenantDb,
  actor: Actor & { tenantId: string },
  request: AuditRequestContext,
  input: ApplyLegalHoldInput,
): Promise<LegalHold> {
  assertValidScope(input)

  const hold = await db.insert(legalHolds, {
    name: input.name,
    reason: input.reason,
    scopeType: input.scopeType,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    matterReference: input.matterReference ?? null,
    appliedByUserId: actor.userId,
  })

  await markCoveredRows(db, input, true)

  await recordAudit(actor, request, {
    action: 'legal_hold.applied',
    entityType: 'legal_hold',
    entityId: hold.id,
    entityLabel: hold.name,
    reason: input.reason,
    tenantId: actor.tenantId,
    metadata: { scopeType: input.scopeType, targetEntityType: input.entityType, targetEntityId: input.entityId },
  })

  return hold
}

export interface ReleaseLegalHoldInput {
  legalHoldId: string
  releaseReason: string
}

export async function releaseLegalHold(
  db: TenantDb,
  actor: Actor & { tenantId: string },
  request: AuditRequestContext,
  input: ReleaseLegalHoldInput,
): Promise<LegalHold> {
  if (input.releaseReason.trim().length < MIN_REASON_LENGTH) {
    throw validationFailed('validation.minLength', { min: MIN_REASON_LENGTH })
  }

  const existing = await db.findById(legalHolds, input.legalHoldId)
  if (!existing) throw notFound('settings.retention.errors.legalHoldNotFound')
  if (existing.releasedAt) throw validationFailed('settings.retention.errors.legalHoldAlreadyReleased')

  const released = await db.update(legalHolds, existing.id, {
    releasedByUserId: actor.userId,
    releasedAt: new Date(),
    releaseReason: input.releaseReason,
  })
  if (!released) throw notFound('settings.retention.errors.legalHoldNotFound')

  await recomputeCoverageAfterRelease(db, existing)

  await recordAudit(actor, request, {
    action: 'legal_hold.released',
    entityType: 'legal_hold',
    entityId: released.id,
    entityLabel: released.name,
    reason: input.releaseReason,
    tenantId: actor.tenantId,
  })

  return released
}

/** Sets or would-set the `legal_hold` column true on every row a hold's scope covers. */
async function markCoveredRows(db: TenantDb, scope: ApplyLegalHoldInput, value: boolean): Promise<void> {
  const targets =
    scope.scopeType === 'tenant'
      ? RETENTION_ENTITY_TYPES
      : scope.entityType
        ? [scope.entityType]
        : []

  for (const entityType of targets) {
    const info = classifyEntity(entityType)
    if (!info || !info.hasLegalHoldColumn) continue
    const table = info.table as never
    const idColumn = (table as { id: unknown }).id as never
    const where = scope.scopeType === 'record' && scope.entityId ? eq(idColumn, scope.entityId) : sql`true`
    await db.updateWhere(table, where!, { legalHold: value } as never)
  }
}

/**
 * After releasing `released`, re-derives which rows remain covered by some
 * *other* still-active hold and clears `legal_hold` everywhere else.
 */
async function recomputeCoverageAfterRelease(db: TenantDb, released: LegalHold): Promise<void> {
  const stillActive = await db.findMany(legalHolds, { where: isNull(legalHolds.releasedAt) })
  const others = stillActive.filter((h) => h.id !== released.id)

  const tenantWideStillHeld = others.some((h) => h.scopeType === 'tenant')
  if (tenantWideStillHeld) return // every row in the tenant remains held; nothing to clear.

  const targets =
    released.scopeType === 'tenant'
      ? RETENTION_ENTITY_TYPES
      : released.entityType
        ? [released.entityType]
        : []

  for (const entityType of targets) {
    const info = classifyEntity(entityType)
    if (!info || !info.hasLegalHoldColumn) continue

    const entityTypeStillHeld = others.some((h) => h.scopeType === 'entity_type' && h.entityType === entityType)
    if (entityTypeStillHeld) continue // the whole type remains held; nothing to clear for it.

    const stillHeldRecordIds = others
      .filter((h) => h.scopeType === 'record' && h.entityType === entityType && h.entityId)
      .map((h) => h.entityId as string)

    const table = info.table as never
    if (released.scopeType === 'record' && released.entityType === entityType && released.entityId) {
      // Only this one record was ever held by `released`; clear it unless
      // another record-level hold on the same row is still active.
      if (stillHeldRecordIds.includes(released.entityId)) continue
      await db.updateWhere(
        table,
        eq((table as { id: unknown }).id as never, released.entityId as never),
        { legalHold: false } as never,
      )
      continue
    }

    // `released` was tenant-wide or entity-type-wide: clear every row of this
    // type except ones a surviving record-level hold still covers.
    const where =
      stillHeldRecordIds.length > 0
        ? notInArray((table as { id: unknown }).id as never, stillHeldRecordIds as never)
        : sql`true`
    await db.updateWhere(table, where!, { legalHold: false } as never)
  }
}

export async function listActiveLegalHolds(db: TenantDb): Promise<LegalHold[]> {
  return db.findMany(legalHolds, { where: isNull(legalHolds.releasedAt) })
}

export async function listLegalHoldHistory(db: TenantDb): Promise<LegalHold[]> {
  return db.findMany(legalHolds, {})
}

/** True when any active hold covers the given specific record. */
export async function isRecordHeld(db: TenantDb, entityType: string, entityId: string): Promise<boolean> {
  const active = await listActiveLegalHolds(db)
  return active.some(
    (h) =>
      h.scopeType === 'tenant' ||
      (h.scopeType === 'entity_type' && h.entityType === entityType) ||
      (h.scopeType === 'record' && h.entityType === entityType && h.entityId === entityId),
  )
}
