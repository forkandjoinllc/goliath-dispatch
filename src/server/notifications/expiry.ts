import 'server-only'
import type { ResourceContext } from '@/lib/permissions'
import { emitNotification, type EmitNotificationResult } from './dispatch'

/**
 * The document-expiration sweep's one call into the notification system.
 *
 * `src/server/documents/service.ts`'s `markExpirations` already materializes
 * an idempotent `documentExpirations` row per (document, kind,
 * expirationDate) — this is the matching notification half. The caller (the
 * daily job) passes the document/owner facts it already has on hand; this
 * module never re-queries `documents` or `carriers` itself, so it stays
 * decoupled from those schemas' evolution.
 *
 * Re-running the sweep for the same document/expirationDate/kind on a second
 * morning calls this again with the same `dedupeSuffix` (the expiration
 * date), so `emitNotification`'s dedupe key is identical and no second
 * notification is created — this is what makes "the sweep emitting twice
 * creates one notification" true regardless of how often the cron fires.
 */

export type DocumentOwnerKind = 'carrier' | 'truck' | 'trailer' | 'driver' | 'load' | 'tenant' | 'invoice'

export interface DocumentExpiryNotificationInput {
  tenantId: string
  documentId: string
  documentType: string
  ownerType: DocumentOwnerKind
  ownerId: string
  ownerName: string
  expirationDate: Date
}

function ownerAudience(ownerType: DocumentOwnerKind, ownerId: string): ResourceContext {
  switch (ownerType) {
    case 'carrier':
      return { carrierId: ownerId }
    case 'truck':
      return { truckId: ownerId }
    case 'trailer':
      return { trailerId: ownerId }
    case 'driver':
      return { driverId: ownerId }
    default:
      return {}
  }
}

function dateSuffix(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function notifyDocumentExpiring(
  input: DocumentExpiryNotificationInput,
  daysRemaining: number,
): Promise<EmitNotificationResult> {
  return emitNotification({
    tenantId: input.tenantId,
    eventKey: 'document.expiring',
    subject: { type: 'document', id: input.documentId },
    audience: ownerAudience(input.ownerType, input.ownerId),
    tokens: {
      documentType: input.documentType,
      ownerName: input.ownerName,
      expirationDate: dateSuffix(input.expirationDate),
      daysRemaining,
    },
    dedupeSuffix: dateSuffix(input.expirationDate),
  })
}

export async function notifyDocumentExpired(
  input: DocumentExpiryNotificationInput,
): Promise<EmitNotificationResult> {
  return emitNotification({
    tenantId: input.tenantId,
    eventKey: 'document.expired',
    subject: { type: 'document', id: input.documentId },
    audience: ownerAudience(input.ownerType, input.ownerId),
    tokens: {
      documentType: input.documentType,
      ownerName: input.ownerName,
      expirationDate: dateSuffix(input.expirationDate),
    },
    dedupeSuffix: dateSuffix(input.expirationDate),
  })
}
