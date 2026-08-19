import 'server-only'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { documentVersions, documents, trailers, trucks } from '@/db/schema'
import { assertKeyBelongsToTenant, getStorage } from '@/lib/storage'
import { getOcrProvider } from '@/integrations/ocr'
import { verifyEquipmentAgainstCoi } from '@/server/verification/equipment-verification'
import { defineJob, type JobContext } from '../registry'

/**
 * Drains the `document.ocr_extract` jobs `documents/service.ts` already
 * enqueues on every certificate-of-insurance upload/new version (see that
 * file's `enqueueOcrJob`, called from `uploadDocument`/`addVersion`).
 * Nothing else in the codebase ever drained that queue before this handler
 * — a COI's `document_versions.extraction_status` stayed `queued` forever.
 *
 * Idempotent: writing `extraction`/`extractionStatus: 'completed'` onto the
 * same version twice with the same source bytes produces the same result
 * (OCR is a pure read of immutable, content-addressed bytes — the version's
 * `sha256` never changes). Re-running the equipment re-verification pass is
 * exactly as idempotent as running it from any other trigger:
 * `verifyEquipmentAgainstCoi` always fully recomputes and inserts a fresh
 * `equipmentVerifications` row from current state, it never mutates one.
 *
 * The safety property this handler exists for: a truck/trailer blocked only
 * on `vin_not_on_coi` must unblock automatically the moment its VIN appears
 * on a freshly-OCR'd COI, without anyone manually re-running verification.
 */

const payloadSchema = z.object({
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
})

export async function extractVinsFromCoi(payload: z.infer<typeof payloadSchema>, ctx: JobContext): Promise<void> {
  if (!ctx.tenantId) throw new Error('document.ocr_extract requires a tenantId')
  const db = tenantDb(ctx.tenantId)

  const document = await db.findById(documents, payload.documentId)
  const version = await db.findById(documentVersions, payload.documentVersionId)
  if (!document || !version || version.documentId !== document.id) {
    // The document (or this specific version) was deleted since the job was
    // enqueued — nothing left to extract or verify against.
    return
  }
  if (document.ownerType !== 'carrier' || document.documentType !== 'certificate_of_insurance') {
    // `documents/service.ts` only ever enqueues this job for a COI; a
    // mismatch here would mean the row's own type changed after enqueue,
    // which is not something a retry can fix.
    return
  }

  assertKeyBelongsToTenant(version.storageKey, db.tenantId)
  const stored = await getStorage().get(version.storageKey)
  const result = await getOcrProvider().extractFromDocument(stored.body, version.contentType)

  await db.update(documentVersions, version.id, {
    extraction: { vins: result.vins, confidence: result.confidence, provider: result.provider },
    extractionStatus: 'completed',
  })

  const carrierId = document.ownerId
  const [carrierTrucks, carrierTrailers] = await Promise.all([
    db.findMany(trucks, { where: eq(trucks.carrierId, carrierId) }),
    db.findMany(trailers, { where: eq(trailers.carrierId, carrierId) }),
  ])

  for (const truck of carrierTrucks) {
    await verifyEquipmentAgainstCoi(db, { equipmentType: 'truck', equipmentId: truck.id, carrierId })
  }
  for (const trailer of carrierTrailers) {
    await verifyEquipmentAgainstCoi(db, { equipmentType: 'trailer', equipmentId: trailer.id, carrierId })
  }
}

defineJob('document.ocr_extract', {
  schema: payloadSchema,
  handler: extractVinsFromCoi,
  defaultMaxAttempts: 5,
  description: 'Runs OCR on a newly uploaded COI and re-verifies every truck/trailer of that carrier against it.',
})
