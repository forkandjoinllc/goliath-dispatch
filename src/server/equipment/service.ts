import 'server-only'
import { and, desc, eq, ne } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  documents,
  equipmentMedia,
  equipmentTypes,
  equipmentVerifications,
  trailers,
  trucks,
  type EquipmentMedia,
  type EquipmentType,
  type Trailer,
  type Truck,
} from '@/db/schema'
import { AppError, conflict, notFound } from '@/lib/errors'
import { newId, sha256Hex } from '@/lib/crypto'
import { normalizeVin } from '@/lib/utils'
import type { Actor } from '@/lib/permissions'
import {
  assertKeyBelongsToTenant,
  buildKey,
  getMalwareScanner,
  getStorage,
  MEDIA_UPLOAD_POLICY,
  validateUpload,
} from '@/lib/storage'
import { equipmentGate, type ComplianceResult, type EquipmentGateInput } from '@/server/compliance'
import {
  MINIMUM_EQUIPMENT_MEDIA,
  REQUIRED_EQUIPMENT_MEDIA_ANGLES,
  verifyEquipmentAgainstCoi,
  type EquipmentType as EquipmentKind,
} from '@/server/verification'
import { decodeVin } from './vin'

/**
 * Truck/trailer CRUD, status lifecycle, media and equipment-type management.
 *
 * As with `carriers/service.ts` and `documents/service.ts`, nothing here
 * checks a permission — `defineAction` already did that. This layer owns
 * VIN normalization/uniqueness, auto-populating year/make/model from the
 * offline decoder, keeping the denormalized `coiVerificationStatus` column in
 * sync with the verification ledger `verifyEquipmentAgainstCoi` writes, the
 * equipment status machine, and equipment media.
 */

type EquipmentTable = typeof trucks | typeof trailers

function tableFor(equipmentType: EquipmentKind): EquipmentTable {
  return equipmentType === 'truck' ? trucks : trailers
}

/* ── VIN uniqueness + decode ─────────────────────────────────────────────── */

async function assertVinAvailable(
  db: TenantDb,
  equipmentType: EquipmentKind,
  vinNormalized: string,
  excludeId?: string,
): Promise<void> {
  const table = tableFor(equipmentType)
  const clauses = [eq(table.vinNormalized, vinNormalized)]
  if (excludeId) clauses.push(ne(table.id, excludeId))
  const taken = await db.exists(table, and(...clauses)!)
  if (taken) {
    throw conflict('errors.duplicateVin', { vin: vinNormalized })
  }
}

interface VinDecodeDefaults {
  year: number | null
  make: string | null
  vinDecodeSource: string | null
  vinDecodedAt: Date | null
}

/**
 * Fills `year`/`make` from the offline decoder only where the caller left
 * the field blank — a user-entered value is never overwritten by a decode.
 * `model` is not decoded: this product's offline table only covers the
 * check digit, model year and WMI-level manufacturer, and fabricating a
 * model guess would violate the "never a guess" rule the WMI table already
 * follows.
 */
function applyVinDecodeDefaults(
  vinNormalized: string,
  provided: { year?: number | null; make?: string | null },
): VinDecodeDefaults {
  const needsYear = provided.year == null
  const needsMake = provided.make == null || provided.make === ''
  if (!needsYear && !needsMake) {
    return { year: provided.year ?? null, make: provided.make ?? null, vinDecodeSource: null, vinDecodedAt: null }
  }

  const decoded = decodeVin(vinNormalized)
  const usedDecode = (needsYear && decoded.year != null) || (needsMake && decoded.make != null)

  return {
    year: needsYear ? decoded.year : (provided.year ?? null),
    make: needsMake ? decoded.make : (provided.make ?? null),
    vinDecodeSource: usedDecode ? decoded.source : null,
    vinDecodedAt: usedDecode ? new Date() : null,
  }
}

/**
 * Runs (or re-runs) COI/VIN verification for one piece of equipment and
 * mirrors the result onto the denormalized `coiVerificationStatus` column so
 * list filters stay index-backed without joining `equipmentVerifications`.
 * Called from every write path that can invalidate a prior verification:
 * VIN change, carrier change, and media upload/reorder/delete.
 */
export async function runEquipmentVerification(
  db: TenantDb,
  input: { equipmentType: EquipmentKind; equipmentId: string; carrierId: string },
): Promise<void> {
  const verification = await verifyEquipmentAgainstCoi(db, input)
  await db.update(tableFor(input.equipmentType), input.equipmentId, {
    coiVerificationStatus: verification.status,
  })
}

/* ── Create ──────────────────────────────────────────────────────────────── */

export interface CreateTruckInput {
  carrierId: string
  unitNumber: string
  vin: string
  year?: number | null
  make?: string | null
  model?: string | null
  equipmentTypeId?: string | null
  plateNumber?: string | null
  plateState?: string | null
  registrationNumber?: string | null
  registrationExpiresAt?: Date | null
  lastInspectionAt?: Date | null
  nextInspectionDueAt?: Date | null
  lastMaintenanceAt?: Date | null
  nextMaintenanceDueAt?: Date | null
  notes?: string | null
}

export async function createTruck(db: TenantDb, _actor: { userId: string }, input: CreateTruckInput): Promise<Truck> {
  const vinNormalized = normalizeVin(input.vin)
  await assertVinAvailable(db, 'truck', vinNormalized)
  const decoded = applyVinDecodeDefaults(vinNormalized, input)

  const truck = await db.insert(trucks, {
    carrierId: input.carrierId,
    unitNumber: input.unitNumber,
    vin: input.vin,
    vinNormalized,
    year: decoded.year,
    make: decoded.make,
    model: input.model ?? null,
    equipmentTypeId: input.equipmentTypeId ?? null,
    plateNumber: input.plateNumber ?? null,
    plateState: input.plateState ?? null,
    status: 'pending_verification',
    vinDecodeSource: decoded.vinDecodeSource,
    vinDecodedAt: decoded.vinDecodedAt,
    registrationNumber: input.registrationNumber ?? null,
    registrationExpiresAt: input.registrationExpiresAt ?? null,
    lastInspectionAt: input.lastInspectionAt ?? null,
    nextInspectionDueAt: input.nextInspectionDueAt ?? null,
    lastMaintenanceAt: input.lastMaintenanceAt ?? null,
    nextMaintenanceDueAt: input.nextMaintenanceDueAt ?? null,
    coiVerificationStatus: 'not_started',
    notes: input.notes ?? null,
  })

  await runEquipmentVerification(db, { equipmentType: 'truck', equipmentId: truck.id, carrierId: truck.carrierId })
  return (await db.findById(trucks, truck.id)) ?? truck
}

export interface CreateTrailerInput {
  carrierId: string
  unitNumber: string
  vin: string
  year?: number | null
  make?: string | null
  model?: string | null
  equipmentTypeId?: string | null
  plateNumber?: string | null
  plateState?: string | null
  lengthInches?: number | null
  widthInches?: number | null
  deckHeightInches?: number | null
  wellLengthInches?: number | null
  capacityPounds?: number | null
  axleCount?: number | null
  axleConfiguration?: string | null
  removableGooseneck?: boolean
  isExtendable?: boolean
  registrationNumber?: string | null
  registrationExpiresAt?: Date | null
  lastInspectionAt?: Date | null
  nextInspectionDueAt?: Date | null
  lastMaintenanceAt?: Date | null
  nextMaintenanceDueAt?: Date | null
  notes?: string | null
}

export async function createTrailer(
  db: TenantDb,
  _actor: { userId: string },
  input: CreateTrailerInput,
): Promise<Trailer> {
  const vinNormalized = normalizeVin(input.vin)
  await assertVinAvailable(db, 'trailer', vinNormalized)
  const decoded = applyVinDecodeDefaults(vinNormalized, input)

  const trailer = await db.insert(trailers, {
    carrierId: input.carrierId,
    unitNumber: input.unitNumber,
    vin: input.vin,
    vinNormalized,
    year: decoded.year,
    make: decoded.make,
    model: input.model ?? null,
    equipmentTypeId: input.equipmentTypeId ?? null,
    plateNumber: input.plateNumber ?? null,
    plateState: input.plateState ?? null,
    lengthInches: input.lengthInches ?? null,
    widthInches: input.widthInches ?? null,
    deckHeightInches: input.deckHeightInches ?? null,
    wellLengthInches: input.wellLengthInches ?? null,
    capacityPounds: input.capacityPounds ?? null,
    axleCount: input.axleCount ?? null,
    axleConfiguration: input.axleConfiguration ?? null,
    removableGooseneck: input.removableGooseneck ?? false,
    isExtendable: input.isExtendable ?? false,
    status: 'pending_verification',
    registrationNumber: input.registrationNumber ?? null,
    registrationExpiresAt: input.registrationExpiresAt ?? null,
    lastInspectionAt: input.lastInspectionAt ?? null,
    nextInspectionDueAt: input.nextInspectionDueAt ?? null,
    lastMaintenanceAt: input.lastMaintenanceAt ?? null,
    nextMaintenanceDueAt: input.nextMaintenanceDueAt ?? null,
    coiVerificationStatus: 'not_started',
    notes: input.notes ?? null,
  })

  await runEquipmentVerification(db, {
    equipmentType: 'trailer',
    equipmentId: trailer.id,
    carrierId: trailer.carrierId,
  })
  return (await db.findById(trailers, trailer.id)) ?? trailer
}

/* ── Update ──────────────────────────────────────────────────────────────── */

export type UpdateTruckInput = Partial<Omit<CreateTruckInput, 'carrierId'>> & { carrierId?: string }
export type UpdateTrailerInput = Partial<Omit<CreateTrailerInput, 'carrierId'>> & { carrierId?: string }

async function updateEquipment<TInput extends { vin?: string; carrierId?: string }>(
  db: TenantDb,
  equipmentType: EquipmentKind,
  equipmentId: string,
  patch: TInput,
  buildPatch: (vinNormalized: string | null, decoded: VinDecodeDefaults | null) => Record<string, unknown>,
): Promise<Truck | Trailer> {
  const table = tableFor(equipmentType)
  const existing = await db.requireById(table, equipmentId, equipmentType)

  let vinNormalized: string | null = null
  let decoded: VinDecodeDefaults | null = null
  let vinChanged = false
  if (patch.vin) {
    vinNormalized = normalizeVin(patch.vin)
    vinChanged = vinNormalized !== existing.vinNormalized
    if (vinChanged) {
      await assertVinAvailable(db, equipmentType, vinNormalized, equipmentId)
      decoded = applyVinDecodeDefaults(vinNormalized, {
        year: (patch as unknown as { year?: number | null }).year,
        make: (patch as unknown as { make?: string | null }).make,
      })
    }
  }

  const carrierChanged = !!patch.carrierId && patch.carrierId !== existing.carrierId

  const values = buildPatch(vinNormalized, decoded)
  const updated = await db.update(table, equipmentId, values)
  if (!updated) throw notFound('errors.notFound', { entity: equipmentType })

  if (vinChanged || carrierChanged) {
    await runEquipmentVerification(db, {
      equipmentType,
      equipmentId,
      carrierId: (updated as Truck | Trailer).carrierId,
    })
    return (await db.findById(table, equipmentId)) ?? updated
  }

  return updated
}

export async function updateTruck(
  db: TenantDb,
  _actor: { userId: string },
  truckId: string,
  patch: UpdateTruckInput,
): Promise<Truck> {
  return updateEquipment(db, 'truck', truckId, patch, (vinNormalized, decoded) => ({
    ...(patch.carrierId !== undefined ? { carrierId: patch.carrierId } : {}),
    ...(patch.unitNumber !== undefined ? { unitNumber: patch.unitNumber } : {}),
    ...(patch.vin !== undefined ? { vin: patch.vin, vinNormalized: vinNormalized ?? undefined } : {}),
    ...(decoded ? { year: decoded.year, make: decoded.make, vinDecodeSource: decoded.vinDecodeSource, vinDecodedAt: decoded.vinDecodedAt } : {}),
    ...(!decoded && patch.year !== undefined ? { year: patch.year } : {}),
    ...(!decoded && patch.make !== undefined ? { make: patch.make } : {}),
    ...(patch.model !== undefined ? { model: patch.model } : {}),
    ...(patch.equipmentTypeId !== undefined ? { equipmentTypeId: patch.equipmentTypeId } : {}),
    ...(patch.plateNumber !== undefined ? { plateNumber: patch.plateNumber } : {}),
    ...(patch.plateState !== undefined ? { plateState: patch.plateState } : {}),
    ...(patch.registrationNumber !== undefined ? { registrationNumber: patch.registrationNumber } : {}),
    ...(patch.registrationExpiresAt !== undefined ? { registrationExpiresAt: patch.registrationExpiresAt } : {}),
    ...(patch.lastInspectionAt !== undefined ? { lastInspectionAt: patch.lastInspectionAt } : {}),
    ...(patch.nextInspectionDueAt !== undefined ? { nextInspectionDueAt: patch.nextInspectionDueAt } : {}),
    ...(patch.lastMaintenanceAt !== undefined ? { lastMaintenanceAt: patch.lastMaintenanceAt } : {}),
    ...(patch.nextMaintenanceDueAt !== undefined ? { nextMaintenanceDueAt: patch.nextMaintenanceDueAt } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
  })) as Promise<Truck>
}

export async function updateTrailer(
  db: TenantDb,
  _actor: { userId: string },
  trailerId: string,
  patch: UpdateTrailerInput,
): Promise<Trailer> {
  return updateEquipment(db, 'trailer', trailerId, patch, (vinNormalized, decoded) => ({
    ...(patch.carrierId !== undefined ? { carrierId: patch.carrierId } : {}),
    ...(patch.unitNumber !== undefined ? { unitNumber: patch.unitNumber } : {}),
    ...(patch.vin !== undefined ? { vin: patch.vin, vinNormalized: vinNormalized ?? undefined } : {}),
    ...(decoded ? { year: decoded.year, make: decoded.make } : {}),
    ...(!decoded && patch.year !== undefined ? { year: patch.year } : {}),
    ...(!decoded && patch.make !== undefined ? { make: patch.make } : {}),
    ...(patch.model !== undefined ? { model: patch.model } : {}),
    ...(patch.equipmentTypeId !== undefined ? { equipmentTypeId: patch.equipmentTypeId } : {}),
    ...(patch.plateNumber !== undefined ? { plateNumber: patch.plateNumber } : {}),
    ...(patch.plateState !== undefined ? { plateState: patch.plateState } : {}),
    ...(patch.lengthInches !== undefined ? { lengthInches: patch.lengthInches } : {}),
    ...(patch.widthInches !== undefined ? { widthInches: patch.widthInches } : {}),
    ...(patch.deckHeightInches !== undefined ? { deckHeightInches: patch.deckHeightInches } : {}),
    ...(patch.wellLengthInches !== undefined ? { wellLengthInches: patch.wellLengthInches } : {}),
    ...(patch.capacityPounds !== undefined ? { capacityPounds: patch.capacityPounds } : {}),
    ...(patch.axleCount !== undefined ? { axleCount: patch.axleCount } : {}),
    ...(patch.axleConfiguration !== undefined ? { axleConfiguration: patch.axleConfiguration } : {}),
    ...(patch.removableGooseneck !== undefined ? { removableGooseneck: patch.removableGooseneck } : {}),
    ...(patch.isExtendable !== undefined ? { isExtendable: patch.isExtendable } : {}),
    ...(patch.registrationNumber !== undefined ? { registrationNumber: patch.registrationNumber } : {}),
    ...(patch.registrationExpiresAt !== undefined ? { registrationExpiresAt: patch.registrationExpiresAt } : {}),
    ...(patch.lastInspectionAt !== undefined ? { lastInspectionAt: patch.lastInspectionAt } : {}),
    ...(patch.nextInspectionDueAt !== undefined ? { nextInspectionDueAt: patch.nextInspectionDueAt } : {}),
    ...(patch.lastMaintenanceAt !== undefined ? { lastMaintenanceAt: patch.lastMaintenanceAt } : {}),
    ...(patch.nextMaintenanceDueAt !== undefined ? { nextMaintenanceDueAt: patch.nextMaintenanceDueAt } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
  })) as Promise<Trailer>
}

/* ── Status lifecycle ────────────────────────────────────────────────────── */

type EquipmentStatus = Truck['status']

const EQUIPMENT_TRANSITIONS: Record<EquipmentStatus, EquipmentStatus[]> = {
  pending_verification: ['active', 'archived'],
  active: ['out_of_service', 'archived'],
  out_of_service: ['active', 'archived'],
  archived: [],
}

/**
 * Loads exactly the facts `equipmentGate` needs, mirroring the loader in
 * `server/compliance/service.ts::evaluateEquipmentForLoad`. Duplicated
 * rather than imported because that loader is private to a module this
 * agent does not own; the *predicate* it calls (`equipmentGate`) is the one
 * piece of compliance logic actually reused here.
 */
async function loadEquipmentGateInput(
  db: TenantDb,
  equipmentType: EquipmentKind,
  equipmentId: string,
  statusOverride?: EquipmentStatus,
): Promise<EquipmentGateInput> {
  const table = tableFor(equipmentType)
  const equipment = await db.requireById(table, equipmentId, equipmentType)

  const verification = await db.findFirst(equipmentVerifications, {
    where: and(
      eq(equipmentVerifications.equipmentType, equipmentType),
      eq(equipmentVerifications.equipmentId, equipmentId),
    )!,
    orderBy: desc(equipmentVerifications.createdAt),
  })

  let coiExpiresAt: Date | null = null
  if (verification?.coiDocumentId) {
    const coiDoc = await db.findById(documents, verification.coiDocumentId)
    coiExpiresAt = coiDoc?.expirationDate ?? null
  }

  return {
    equipmentType,
    status: statusOverride ?? equipment.status,
    verification: verification
      ? {
          status: verification.status,
          blockingReasons: verification.blockingReasons,
          vin: equipment.vinNormalized,
          coiExpiresAt,
        }
      : null,
    mediaApprovedCount: verification?.mediaCount ?? 0,
    registrationExpiresAt: equipment.registrationExpiresAt,
    nextInspectionDueAt: equipment.nextInspectionDueAt,
  }
}

/**
 * Would this equipment satisfy the compliance gate if it were `active` right
 * now? Evaluated as if activation had already happened — the same trick
 * `evaluateCarrierReadinessForApproval` uses for onboarding — so "equipment
 * is not active" never blocks its own activation decision. An existing
 * `manually_overridden` verification still counts as passing, exactly as it
 * does for load assignment.
 */
export async function evaluateEquipmentReadinessForActivation(
  db: TenantDb,
  equipmentType: EquipmentKind,
  equipmentId: string,
): Promise<ComplianceResult> {
  return equipmentGate(await loadEquipmentGateInput(db, equipmentType, equipmentId, 'active'))
}

export interface TransitionEquipmentStatusInput {
  equipmentType: EquipmentKind
  equipmentId: string
  toStatus: EquipmentStatus
  reason?: string | null
}

export async function transitionEquipmentStatus(
  db: TenantDb,
  _actor: { userId: string },
  input: TransitionEquipmentStatusInput,
): Promise<Truck | Trailer> {
  const table = tableFor(input.equipmentType)
  const equipment = await db.requireById(table, input.equipmentId, input.equipmentType)

  const allowed = EQUIPMENT_TRANSITIONS[equipment.status] ?? []
  if (!allowed.includes(input.toStatus)) {
    throw conflict('equipment.errors.invalidTransition', { from: equipment.status, to: input.toStatus })
  }

  if (input.toStatus === 'out_of_service' && !input.reason?.trim()) {
    throw new AppError('validation_failed', 'validation.required')
  }

  if (input.toStatus === 'active') {
    const readiness = await evaluateEquipmentReadinessForActivation(db, input.equipmentType, input.equipmentId)
    if (!readiness.ok) {
      throw new AppError('compliance_blocked', 'equipment.errors.blockedByCompliance', {
        params: { count: readiness.blocking.length },
      })
    }
  }

  const patch: Partial<Truck | Trailer> = { status: input.toStatus }
  if (input.toStatus === 'out_of_service') {
    ;(patch as { outOfServiceReason?: string | null }).outOfServiceReason = input.reason ?? null
  } else {
    ;(patch as { outOfServiceReason?: string | null }).outOfServiceReason = null
  }

  const updated = await db.update(table, input.equipmentId, patch)
  if (!updated) throw notFound('errors.notFound', { entity: input.equipmentType })
  return updated
}

/* ── Media ───────────────────────────────────────────────────────────────── */

export { MINIMUM_EQUIPMENT_MEDIA, REQUIRED_EQUIPMENT_MEDIA_ANGLES }

export type EquipmentMediaAngle = (typeof REQUIRED_EQUIPMENT_MEDIA_ANGLES)[number] | 'interior' | 'detail'

export interface UploadEquipmentMediaInput {
  equipmentType: EquipmentKind
  equipmentId: string
  angle: EquipmentMediaAngle
  mediaKind?: 'photo' | 'video'
  caption?: string | null
  originalFilename: string
  bytes: Buffer
}

export async function uploadEquipmentMedia(
  db: TenantDb,
  actor: Actor,
  input: UploadEquipmentMediaInput,
): Promise<EquipmentMedia> {
  const table = tableFor(input.equipmentType)
  const equipment = await db.requireById(table, input.equipmentId, input.equipmentType)

  const sniffed = validateUpload(input.bytes, MEDIA_UPLOAD_POLICY)
  const scanResult = await getMalwareScanner().scan(input.bytes)
  if (!scanResult.clean) {
    throw new AppError('validation_failed', 'errors.malwareDetected', { detail: { signature: scanResult.signature } })
  }

  const mediaId = newId()
  // `buildKey` is the shared, tenant-prefixed key builder every upload in
  // this product goes through. Equipment media has no `documents` row, so
  // the media's own id stands in for `documentId` and the version is always
  // 1 — the tenant-prefix guarantee (`assertKeyBelongsToTenant`) is what
  // actually matters here, not the "documents" path segment.
  const key = buildKey({
    tenantId: db.tenantId,
    ownerType: input.equipmentType,
    ownerId: input.equipmentId,
    documentId: mediaId,
    versionNumber: 1,
    filename: input.originalFilename,
  })
  assertKeyBelongsToTenant(key, db.tenantId)
  await getStorage().put({ key, body: input.bytes, contentType: sniffed.mimeType })

  const existingCount = await db.count(
    equipmentMedia,
    and(eq(equipmentMedia.equipmentType, input.equipmentType), eq(equipmentMedia.equipmentId, input.equipmentId))!,
  )

  const media = await db.insert(equipmentMedia, {
    id: mediaId,
    equipmentType: input.equipmentType,
    equipmentId: input.equipmentId,
    angle: input.angle,
    mediaKind: input.mediaKind ?? 'photo',
    storageKey: key,
    contentType: sniffed.mimeType,
    byteSize: input.bytes.byteLength,
    sha256: sha256Hex(input.bytes),
    caption: input.caption ?? null,
    sortOrder: existingCount,
    uploadedByUserId: actor.userId,
  })

  await runEquipmentVerification(db, {
    equipmentType: input.equipmentType,
    equipmentId: input.equipmentId,
    carrierId: equipment.carrierId,
  })

  return media
}

export interface ReorderEquipmentMediaInput {
  equipmentType: EquipmentKind
  equipmentId: string
  orderedMediaIds: string[]
}

export async function reorderEquipmentMedia(
  db: TenantDb,
  _actor: { userId: string },
  input: ReorderEquipmentMediaInput,
): Promise<EquipmentMedia[]> {
  const rows = await db.findMany(equipmentMedia, {
    where: and(
      eq(equipmentMedia.equipmentType, input.equipmentType),
      eq(equipmentMedia.equipmentId, input.equipmentId),
    )!,
  })
  const byId = new Map(rows.map((r) => [r.id, r]))

  const updated: EquipmentMedia[] = []
  for (const [index, mediaId] of input.orderedMediaIds.entries()) {
    if (!byId.has(mediaId)) throw notFound('errors.notFound', { entity: 'equipmentMedia' })
    const row = await db.update(equipmentMedia, mediaId, { sortOrder: index })
    if (row) updated.push(row)
  }
  return updated
}

export interface DeleteEquipmentMediaInput {
  equipmentType: EquipmentKind
  equipmentId: string
  mediaId: string
  reason?: string | null
}

export async function deleteEquipmentMedia(
  db: TenantDb,
  actor: Actor,
  input: DeleteEquipmentMediaInput,
): Promise<EquipmentMedia> {
  const table = tableFor(input.equipmentType)
  const equipment = await db.requireById(table, input.equipmentId, input.equipmentType)
  const media = await db.requireById(equipmentMedia, input.mediaId, 'equipmentMedia')
  if (media.equipmentId !== input.equipmentId || media.equipmentType !== input.equipmentType) {
    throw notFound('errors.notFound', { entity: 'equipmentMedia' })
  }

  const updated = await db.softDelete(equipmentMedia, input.mediaId, actor.userId, input.reason ?? undefined)
  if (!updated) throw notFound('errors.notFound', { entity: 'equipmentMedia' })

  await runEquipmentVerification(db, {
    equipmentType: input.equipmentType,
    equipmentId: input.equipmentId,
    carrierId: equipment.carrierId,
  })

  return updated
}

/** Which of the four required angles are still missing — drives the "missing angle" UI warning. */
export async function missingRequiredAngles(
  db: TenantDb,
  equipmentType: EquipmentKind,
  equipmentId: string,
): Promise<string[]> {
  const rows = await db.findMany(equipmentMedia, {
    where: and(eq(equipmentMedia.equipmentType, equipmentType), eq(equipmentMedia.equipmentId, equipmentId))!,
  })
  const present = new Set(rows.map((r) => r.angle))
  return REQUIRED_EQUIPMENT_MEDIA_ANGLES.filter((angle) => !present.has(angle))
}

/* ── Equipment types ─────────────────────────────────────────────────────── */

export interface CreateEquipmentTypeInput {
  code: string
  labelEn: string
  labelEs: string
  category: 'truck' | 'trailer'
  supportsRgn?: boolean
  sortOrder?: number
}

export async function createEquipmentType(
  db: TenantDb,
  _actor: { userId: string },
  input: CreateEquipmentTypeInput,
): Promise<EquipmentType> {
  const taken = await db.exists(equipmentTypes, eq(equipmentTypes.code, input.code))
  if (taken) throw conflict('equipment.errors.duplicateTypeCode', { code: input.code })

  return db.insert(equipmentTypes, {
    code: input.code,
    labelEn: input.labelEn,
    labelEs: input.labelEs,
    category: input.category,
    isSystem: false,
    supportsRgn: input.supportsRgn ?? false,
    sortOrder: input.sortOrder ?? 0,
    active: true,
  })
}

export interface UpdateEquipmentTypeInput {
  labelEn?: string
  labelEs?: string
  supportsRgn?: boolean
  sortOrder?: number
}

export async function updateEquipmentType(
  db: TenantDb,
  _actor: { userId: string },
  typeId: string,
  patch: UpdateEquipmentTypeInput,
): Promise<EquipmentType> {
  const updated = await db.update(equipmentTypes, typeId, patch)
  if (!updated) throw notFound('errors.notFound', { entity: 'equipmentType' })
  return updated
}

export async function setEquipmentTypeActive(
  db: TenantDb,
  _actor: { userId: string },
  typeId: string,
  active: boolean,
): Promise<EquipmentType> {
  const updated = await db.update(equipmentTypes, typeId, { active })
  if (!updated) throw notFound('errors.notFound', { entity: 'equipmentType' })
  return updated
}

/** Non-system types only — a system type (seeded, used by the compliance/oversize rules) can only be deactivated. */
export async function deleteEquipmentType(
  db: TenantDb,
  actor: { userId: string },
  typeId: string,
  reason?: string,
): Promise<EquipmentType> {
  const type = await db.requireById(equipmentTypes, typeId, 'equipmentType')
  if (type.isSystem) {
    throw conflict('equipment.errors.systemTypeImmutable', { code: type.code })
  }
  const updated = await db.softDelete(equipmentTypes, typeId, actor.userId, reason)
  if (!updated) throw notFound('errors.notFound', { entity: 'equipmentType' })
  return updated
}

/**
 * Short-lived signed URL for one equipment media object. Equipment media has
 * no `documents` row (see `uploadEquipmentMedia`'s comment), so it can't go
 * through `documents/service.ts`'s `getDownloadUrl` — this calls the same
 * underlying `StorageDriver.signedDownloadUrl` directly instead of
 * reimplementing any document logic.
 */
export async function equipmentMediaDownloadUrl(media: EquipmentMedia): Promise<string> {
  return getStorage().signedDownloadUrl(media.storageKey)
}

/* ── Helpers reused by queries.ts ────────────────────────────────────────── */

export function isRequiredAngle(angle: string): angle is (typeof REQUIRED_EQUIPMENT_MEDIA_ANGLES)[number] {
  return (REQUIRED_EQUIPMENT_MEDIA_ANGLES as readonly string[]).includes(angle)
}

/** True while any other equipment row for this carrier is mid-transition to the same unit number — kept trivial on purpose; the DB unique index is the real guard. */
export async function unitNumberAvailable(
  db: TenantDb,
  equipmentType: EquipmentKind,
  carrierId: string,
  unitNumber: string,
  excludeId?: string,
): Promise<boolean> {
  const table = tableFor(equipmentType)
  const clauses = [eq(table.carrierId, carrierId), eq(table.unitNumber, unitNumber)]
  if (excludeId) clauses.push(ne(table.id, excludeId))
  return !(await db.exists(table, and(...clauses)!))
}
