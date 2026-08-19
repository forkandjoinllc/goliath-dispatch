'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { tenantDb } from '@/db/tenant-db'
import { trailers, trucks } from '@/db/schema'
import { equipmentStatusEnum } from '@/db/schema/_shared'
import { reasonSchema, uuidSchema, usStateSchema, vinSchema } from '@/lib/validation'
import type { Actor, ResourceContext } from '@/lib/permissions'
import {
  createEquipmentType,
  createTrailer,
  createTruck,
  deleteEquipmentMedia,
  deleteEquipmentType,
  reorderEquipmentMedia,
  setEquipmentTypeActive,
  transitionEquipmentStatus,
  updateEquipmentType,
  updateTrailer,
  updateTruck,
  uploadEquipmentMedia,
} from './service'

/**
 * Server actions for trucks, trailers, equipment media and equipment types.
 *
 * Every mutation resolves its `resource()` from the actual database row
 * (never a client-supplied carrier id) so a dispatcher's `assigned` scope and
 * a carrier user's `carrier` scope are checked against the truth, exactly as
 * `server/documents/actions.ts` and `server/verification/actions.ts` do.
 */

function tenantDbFor(actor: Actor) {
  if (!actor.tenantId) throw new Error('resource resolver requires a tenant-scoped actor')
  return tenantDb(actor.tenantId)
}

const equipmentTypeKind = z.enum(['truck', 'trailer'])

async function equipmentResource(
  input: { equipmentType: 'truck' | 'trailer'; equipmentId: string },
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  const db = tenantDbFor(ctx.actor)
  const table = input.equipmentType === 'truck' ? trucks : trailers
  const record = await db.findById(table, input.equipmentId)
  return {
    tenantId: ctx.actor.tenantId,
    carrierId: record?.carrierId ?? null,
    ...(input.equipmentType === 'truck' ? { truckId: input.equipmentId } : { trailerId: input.equipmentId }),
  }
}

/* ── Create ──────────────────────────────────────────────────────────────── */

const createTruckInput = z.object({
  carrierId: uuidSchema,
  unitNumber: z.string().trim().min(1).max(40),
  vin: vinSchema,
  year: z.number().int().min(1980).max(2100).optional().nullable(),
  make: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(60).optional().nullable(),
  equipmentTypeId: uuidSchema.optional().nullable(),
  plateNumber: z.string().trim().max(20).optional().nullable(),
  plateState: usStateSchema.optional().nullable(),
  registrationNumber: z.string().trim().max(60).optional().nullable(),
  registrationExpiresAt: z.coerce.date().optional().nullable(),
  lastInspectionAt: z.coerce.date().optional().nullable(),
  nextInspectionDueAt: z.coerce.date().optional().nullable(),
  lastMaintenanceAt: z.coerce.date().optional().nullable(),
  nextMaintenanceDueAt: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const createTruckAction = defineAction({
  name: 'equipment.truck.create',
  permission: 'equipment:create',
  input: createTruckInput,
  resource: (input, ctx) => ({ tenantId: ctx.actor.tenantId, carrierId: input.carrierId }),
  handler: (input, ctx) => createTruck(ctx.db, ctx.actor, input),
  // No `equipment.*` audit action exists in `auditActionEnum` (see
  // `document.restore`'s comment in `server/documents/actions.ts` for the
  // project's stance on this: better to omit than to borrow a misleading
  // action name). The row's own `createdAt`/`createdBy` already records who
  // and when; a compliance-relevant audit trail entry is written the moment
  // `verifyEquipmentAgainstCoi` runs, via `verification.override` when that
  // path is used.
})

const createTrailerInput = z.object({
  carrierId: uuidSchema,
  unitNumber: z.string().trim().min(1).max(40),
  vin: vinSchema,
  year: z.number().int().min(1980).max(2100).optional().nullable(),
  make: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(60).optional().nullable(),
  equipmentTypeId: uuidSchema.optional().nullable(),
  plateNumber: z.string().trim().max(20).optional().nullable(),
  plateState: usStateSchema.optional().nullable(),
  lengthInches: z.number().int().positive().optional().nullable(),
  widthInches: z.number().int().positive().optional().nullable(),
  deckHeightInches: z.number().int().positive().optional().nullable(),
  wellLengthInches: z.number().int().positive().optional().nullable(),
  capacityPounds: z.number().int().positive().optional().nullable(),
  axleCount: z.number().int().positive().optional().nullable(),
  axleConfiguration: z.string().trim().max(60).optional().nullable(),
  removableGooseneck: z.boolean().optional(),
  isExtendable: z.boolean().optional(),
  registrationNumber: z.string().trim().max(60).optional().nullable(),
  registrationExpiresAt: z.coerce.date().optional().nullable(),
  lastInspectionAt: z.coerce.date().optional().nullable(),
  nextInspectionDueAt: z.coerce.date().optional().nullable(),
  lastMaintenanceAt: z.coerce.date().optional().nullable(),
  nextMaintenanceDueAt: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const createTrailerAction = defineAction({
  name: 'equipment.trailer.create',
  permission: 'equipment:create',
  input: createTrailerInput,
  resource: (input, ctx) => ({ tenantId: ctx.actor.tenantId, carrierId: input.carrierId }),
  handler: (input, ctx) => createTrailer(ctx.db, ctx.actor, input),
})

/* ── Update ──────────────────────────────────────────────────────────────── */

const updateTruckInput = createTruckInput.partial().extend({ truckId: uuidSchema })

export const updateTruckAction = defineAction({
  name: 'equipment.truck.update',
  permission: 'equipment:update',
  input: updateTruckInput,
  resource: (input, ctx) => equipmentResource({ equipmentType: 'truck', equipmentId: input.truckId }, ctx),
  handler: ({ truckId, ...patch }, ctx) => updateTruck(ctx.db, ctx.actor, truckId, patch),
})

const updateTrailerInput = createTrailerInput.partial().extend({ trailerId: uuidSchema })

export const updateTrailerAction = defineAction({
  name: 'equipment.trailer.update',
  permission: 'equipment:update',
  input: updateTrailerInput,
  resource: (input, ctx) => equipmentResource({ equipmentType: 'trailer', equipmentId: input.trailerId }, ctx),
  handler: ({ trailerId, ...patch }, ctx) => updateTrailer(ctx.db, ctx.actor, trailerId, patch),
})

/* ── Status lifecycle ────────────────────────────────────────────────────── */

const transitionStatusInput = z.object({
  equipmentType: equipmentTypeKind,
  equipmentId: uuidSchema,
  toStatus: z.enum(equipmentStatusEnum.enumValues),
  reason: z.string().trim().max(500).optional().nullable(),
})

export const transitionEquipmentStatusAction = defineAction({
  name: 'equipment.status.transition',
  permission: 'equipment:status:update',
  input: transitionStatusInput,
  resource: (input, ctx) => equipmentResource(input, ctx),
  handler: (input, ctx) => transitionEquipmentStatus(ctx.db, ctx.actor, input),
})

/* ── Media ───────────────────────────────────────────────────────────────── */

const mediaAngleSchema = z.enum(['front', 'rear', 'driver_side', 'passenger_side', 'interior', 'detail'])

const uploadMediaInput = z.object({
  equipmentType: equipmentTypeKind,
  equipmentId: uuidSchema,
  angle: mediaAngleSchema,
  mediaKind: z.enum(['photo', 'video']).optional(),
  caption: z.string().trim().max(200).optional().nullable(),
  originalFilename: z.string().trim().min(1).max(255),
  /** Base64-encoded bytes — see `document.upload` for the same convention. */
  fileBase64: z.string().min(1),
})

export const uploadEquipmentMediaAction = defineAction({
  name: 'equipment.media.upload',
  permission: 'equipment:media:upload',
  input: uploadMediaInput,
  resource: (input, ctx) => equipmentResource(input, ctx),
  handler: (input, ctx) => {
    const bytes = Buffer.from(input.fileBase64, 'base64')
    return uploadEquipmentMedia(ctx.db, ctx.actor, { ...input, bytes })
  },
  audit: (input, output) => ({
    action: 'document.uploaded',
    entityType: 'equipmentMedia',
    entityId: output.id,
    metadata: { equipmentType: input.equipmentType, equipmentId: input.equipmentId, angle: input.angle },
  }),
})

const reorderMediaInput = z.object({
  equipmentType: equipmentTypeKind,
  equipmentId: uuidSchema,
  orderedMediaIds: z.array(uuidSchema).min(1),
})

export const reorderEquipmentMediaAction = defineAction({
  name: 'equipment.media.reorder',
  permission: 'equipment:media:upload',
  input: reorderMediaInput,
  resource: (input, ctx) => equipmentResource(input, ctx),
  handler: (input, ctx) => reorderEquipmentMedia(ctx.db, ctx.actor, input),
})

const deleteMediaInput = z.object({
  equipmentType: equipmentTypeKind,
  equipmentId: uuidSchema,
  mediaId: uuidSchema,
  reason: z.string().trim().max(500).optional().nullable(),
})

export const deleteEquipmentMediaAction = defineAction({
  name: 'equipment.media.delete',
  permission: 'equipment:media:upload',
  input: deleteMediaInput,
  resource: (input, ctx) => equipmentResource(input, ctx),
  handler: (input, ctx) => deleteEquipmentMedia(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'document.deleted',
    entityType: 'equipmentMedia',
    entityId: output.id,
    reason: input.reason ?? 'not provided',
    metadata: { equipmentType: input.equipmentType, equipmentId: input.equipmentId },
  }),
})

/* ── Equipment types ─────────────────────────────────────────────────────── */

const createEquipmentTypeInput = z.object({
  code: z.string().trim().min(1).max(40),
  labelEn: z.string().trim().min(1).max(120),
  labelEs: z.string().trim().min(1).max(120),
  category: z.enum(['truck', 'trailer']),
  supportsRgn: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export const createEquipmentTypeAction = defineAction({
  name: 'equipment.type.create',
  permission: 'equipment:type:manage',
  input: createEquipmentTypeInput,
  handler: (input, ctx) => createEquipmentType(ctx.db, ctx.actor, input),
  audit: (_input, output) => ({
    action: 'settings.updated',
    entityType: 'equipmentType',
    entityId: output.id,
    entityLabel: output.labelEn,
    metadata: { action: 'created', code: output.code },
  }),
})

const updateEquipmentTypeInput = z.object({
  typeId: uuidSchema,
  labelEn: z.string().trim().min(1).max(120).optional(),
  labelEs: z.string().trim().min(1).max(120).optional(),
  supportsRgn: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export const updateEquipmentTypeAction = defineAction({
  name: 'equipment.type.update',
  permission: 'equipment:type:manage',
  input: updateEquipmentTypeInput,
  handler: ({ typeId, ...patch }, ctx) => updateEquipmentType(ctx.db, ctx.actor, typeId, patch),
  audit: (_input, output) => ({
    action: 'settings.updated',
    entityType: 'equipmentType',
    entityId: output.id,
    entityLabel: output.labelEn,
    metadata: { action: 'updated' },
  }),
})

const setEquipmentTypeActiveInput = z.object({ typeId: uuidSchema, active: z.boolean() })

export const setEquipmentTypeActiveAction = defineAction({
  name: 'equipment.type.setActive',
  permission: 'equipment:type:manage',
  input: setEquipmentTypeActiveInput,
  handler: (input, ctx) => setEquipmentTypeActive(ctx.db, ctx.actor, input.typeId, input.active),
  audit: (input, output) => ({
    action: 'settings.updated',
    entityType: 'equipmentType',
    entityId: output.id,
    entityLabel: output.labelEn,
    metadata: { action: input.active ? 'activated' : 'deactivated' },
  }),
})

const deleteEquipmentTypeInput = z.object({ typeId: uuidSchema, reason: reasonSchema.optional() })

export const deleteEquipmentTypeAction = defineAction({
  name: 'equipment.type.delete',
  permission: 'equipment:type:manage',
  input: deleteEquipmentTypeInput,
  handler: (input, ctx) => deleteEquipmentType(ctx.db, ctx.actor, input.typeId, input.reason),
  audit: (input, output) => ({
    action: 'settings.updated',
    entityType: 'equipmentType',
    entityId: output.id,
    reason: input.reason,
    metadata: { action: 'deleted' },
  }),
})
