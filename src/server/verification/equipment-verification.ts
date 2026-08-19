import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  documentVersions,
  documents,
  equipmentMedia,
  equipmentVerifications,
  trailers,
  trucks,
  type EquipmentVerification,
} from '@/db/schema'
import { AppError, notFound } from '@/lib/errors'
import { assertKeyBelongsToTenant, getStorage } from '@/lib/storage'
import { getOcrProvider } from '@/integrations/ocr'
import { normalizeVin } from '@/lib/utils'

/**
 * The COI/VIN verification engine.
 *
 * Equipment CRUD (creating/editing a truck or trailer) belongs to another
 * layer; this module owns only the *verification* logic they call after a
 * truck/trailer is created, a COI is approved, or media is uploaded.
 */

/** Every truck/trailer needs at least this many approved photos before it can go active. */
export const MINIMUM_EQUIPMENT_MEDIA = 4

/** The four angles a complete equipment media set must cover. */
export const REQUIRED_EQUIPMENT_MEDIA_ANGLES = [
  'front',
  'rear',
  'driver_side',
  'passenger_side',
] as const

export type EquipmentType = 'truck' | 'trailer'

export type EquipmentBlockingReasonCode =
  | 'vin_not_on_coi'
  | 'no_approved_coi'
  | 'coi_expired'
  | 'insufficient_media'
  | 'ocr_failed'

export interface VerifyEquipmentInput {
  equipmentType: EquipmentType
  equipmentId: string
  carrierId: string
}

interface CachedExtraction {
  vins?: string[]
}

/**
 * Finds the carrier's current approved COI, reads (or runs) OCR extraction on
 * it, compares the equipment's normalized VIN against the extracted set
 * exactly, counts approved media, and writes an `equipmentVerifications` row
 * with every unmet gate named explicitly in `blockingReasons`.
 */
export async function verifyEquipmentAgainstCoi(
  db: TenantDb,
  input: VerifyEquipmentInput,
): Promise<EquipmentVerification> {
  const table = input.equipmentType === 'truck' ? trucks : trailers
  const equipment = await db.requireById(table, input.equipmentId, input.equipmentType)

  const blockingReasons: EquipmentBlockingReasonCode[] = []
  let matchedVin: string | null = null
  let extractedVins: string[] = []
  let coiDocumentId: string | null = null
  let coiDocumentVersionId: string | null = null
  let ocrProviderName = getOcrProvider().name

  const now = new Date()

  const mediaCount = await db.count(
    equipmentMedia,
    and(
      eq(equipmentMedia.equipmentType, input.equipmentType),
      eq(equipmentMedia.equipmentId, input.equipmentId),
      eq(equipmentMedia.mediaKind, 'photo'),
    )!,
  )

  const approvedCois = await db.findMany(documents, {
    where: and(
      eq(documents.ownerType, 'carrier'),
      eq(documents.ownerId, input.carrierId),
      eq(documents.documentType, 'certificate_of_insurance'),
      eq(documents.reviewStatus, 'approved'),
    )!,
    orderBy: desc(documents.createdAt),
  })

  const currentCoi =
    approvedCois.find((doc) => !doc.expirationDate || doc.expirationDate.getTime() > now.getTime()) ??
    approvedCois[0] ??
    null

  if (!currentCoi) {
    blockingReasons.push('no_approved_coi')
  } else {
    coiDocumentId = currentCoi.id
    const isExpired = !!currentCoi.expirationDate && currentCoi.expirationDate.getTime() <= now.getTime()
    if (isExpired) {
      blockingReasons.push('coi_expired')
    }

    if (currentCoi.currentVersionId) {
      const version = await db.findById(documentVersions, currentCoi.currentVersionId)
      if (version) {
        coiDocumentVersionId = version.id
        const cached = version.extraction as CachedExtraction | null

        if (cached?.vins) {
          extractedVins = cached.vins
        } else {
          try {
            assertKeyBelongsToTenant(version.storageKey, db.tenantId)
            const stored = await getStorage().get(version.storageKey)
            const result = await getOcrProvider().extractFromDocument(stored.body, version.contentType)
            extractedVins = result.vins
            ocrProviderName = result.provider
            await db.update(documentVersions, version.id, {
              extraction: { vins: result.vins, confidence: result.confidence, provider: result.provider },
              extractionStatus: 'completed',
            })
          } catch {
            blockingReasons.push('ocr_failed')
          }
        }
      }
    }

    if (!isExpired && !blockingReasons.includes('ocr_failed')) {
      const normalizedExtracted = new Set(extractedVins.map((vin) => normalizeVin(vin)))
      if (normalizedExtracted.has(equipment.vinNormalized)) {
        matchedVin = equipment.vinNormalized
      } else {
        blockingReasons.push('vin_not_on_coi')
      }
    }
  }

  if (mediaCount < MINIMUM_EQUIPMENT_MEDIA) {
    blockingReasons.push('insufficient_media')
  }

  const status: EquipmentVerification['status'] =
    blockingReasons.length === 0
      ? 'verified'
      : blockingReasons.includes('vin_not_on_coi') && blockingReasons.length === 1
        ? 'mismatch'
        : 'failed'

  return db.insert(equipmentVerifications, {
    equipmentType: input.equipmentType,
    equipmentId: input.equipmentId,
    carrierId: input.carrierId,
    coiDocumentId,
    coiDocumentVersionId,
    status,
    extractedVins,
    matchedVin,
    ocrProvider: ocrProviderName,
    mediaCount,
    blockingReasons,
    verifiedAt: status === 'verified' ? now : null,
  })
}

/**
 * Admin/Accounting-only escape hatch for a COI/VIN mismatch the business has
 * decided to accept. Permission enforcement happens in the calling action
 * (`equipment:verification:override`); this function only enforces the
 * written-reason requirement and the audit-relevant state transition.
 */
export async function overrideEquipmentVerification(
  db: TenantDb,
  actor: { userId: string },
  verificationId: string,
  reason: string,
): Promise<EquipmentVerification> {
  if (!reason?.trim()) {
    throw new AppError('validation_failed', 'validation.required')
  }

  await db.requireById(equipmentVerifications, verificationId, 'equipmentVerification')

  const updated = await db.update(equipmentVerifications, verificationId, {
    status: 'manually_overridden',
    overriddenByUserId: actor.userId,
    overrideReason: reason,
    overriddenAt: new Date(),
  })
  if (!updated) throw notFound('errors.notFound', { entity: 'equipmentVerification' })
  return updated
}
