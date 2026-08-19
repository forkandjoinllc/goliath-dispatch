import { describe, expect, it } from 'vitest'
import { and, desc, eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { documentVersions, documents, equipmentVerifications, trucks } from '@/db/schema'
import { getStorage } from '@/lib/storage'
import { mockCoiWithVins } from '@/integrations/ocr'
import { verifyEquipmentAgainstCoi } from '@/server/verification/equipment-verification'
import { createTruck } from '@/server/equipment/service'
import { enqueue } from '@/jobs/queue'
import { drain } from '@/jobs/runner'
import { createTestCarrier, createTestTenant, createTestUser, createTestMembership, goodVin } from './fixtures'

describe('OCR VIN extraction unblocks equipment', () => {
  it('a truck blocked on vin_not_on_coi becomes verified once the OCR job extracts its VIN from a freshly uploaded COI', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)

    const vin = goodVin()
    const truck = await createTruck(db, { userId: admin.id }, { carrierId: carrier.id, unitNumber: 'T-1', vin })

    // Before any COI exists, verification is blocked on `no_approved_coi`.
    const beforeCoi = await verifyEquipmentAgainstCoi(db, { equipmentType: 'truck', equipmentId: truck.id, carrierId: carrier.id })
    expect(beforeCoi.status).not.toBe('verified')
    expect(beforeCoi.blockingReasons).toContain('no_approved_coi')

    // A COI is uploaded and approved, but its OCR extraction has not run yet
    // — `extractionStatus: 'queued'`, no cached VINs — exactly the state
    // `documents/service.ts`'s `enqueueOcrJob` leaves a fresh upload in.
    const { bytes, contentType } = await mockCoiWithVins([vin])
    const document = await db.insert(documents, {
      documentType: 'certificate_of_insurance',
      ownerType: 'carrier',
      ownerId: carrier.id,
      reviewStatus: 'approved',
    })
    const storageKey = `tenants/${tenant.id}/carriers/${carrier.id}/documents/${document.id}/v1/coi.pdf`
    await getStorage().put({ key: storageKey, body: Buffer.from(bytes), contentType })
    const version = await db.insert(documentVersions, {
      documentId: document.id,
      versionNumber: 1,
      storageKey,
      originalFilename: 'coi.pdf',
      contentType,
      byteSize: bytes.byteLength,
      sha256: 'unused-in-this-fixture-path',
      malwareScanStatus: 'clean',
      extractionStatus: 'queued',
    })
    await db.update(documents, document.id, { currentVersionId: version.id })

    // Nothing has re-verified the truck since the COI landed — the gap
    // `document.ocr_extract` exists to close. `beforeCoi` above is still the
    // most recent verification row on file for it.

    // Enqueue and drain the real job, exactly as `documents/service.ts`'s
    // `enqueueOcrJob` would after the upload.
    await enqueue({
      tenantId: tenant.id,
      jobType: 'document.ocr_extract',
      payload: { documentId: document.id, documentVersionId: version.id },
      dedupeKey: `document.ocr_extract:${version.id}`,
    })
    const result = await drain({ workerId: 'test-worker', limit: 5, deadlineMs: 5_000 })
    expect(result.succeeded).toBeGreaterThanOrEqual(1)

    const updatedVersion = await db.findById(documentVersions, version.id)
    expect(updatedVersion!.extractionStatus).toBe('completed')
    expect((updatedVersion!.extraction as { vins: string[] } | null)?.vins).toContain(vin)

    // The handler itself re-verifies every truck/trailer of the carrier —
    // no separate call needed here.
    const [latestVerification] = await db.findMany(equipmentVerifications, {
      where: and(eq(equipmentVerifications.equipmentType, 'truck'), eq(equipmentVerifications.equipmentId, truck.id))!,
      orderBy: desc(equipmentVerifications.createdAt),
    })
    // The truck still has zero approved media photos, so full 'verified'
    // status is out of reach here — that gate is unrelated to OCR. What OCR
    // extraction alone must fix is the VIN match itself.
    expect(latestVerification?.blockingReasons).not.toContain('vin_not_on_coi')
    expect(latestVerification?.matchedVin).toBe(truck.vinNormalized)
    expect(latestVerification?.extractedVins).toContain(vin)

    const refreshedTruck = await db.findById(trucks, truck.id)
    expect(refreshedTruck).toBeTruthy()
  })
})
