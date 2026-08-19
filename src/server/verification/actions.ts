'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { carriers } from '@/db/schema'
import { reasonSchema, uuidSchema } from '@/lib/validation'
import type { Actor, ResourceContext } from '@/lib/permissions'
import { overrideEquipmentVerification, verifyEquipmentAgainstCoi } from './equipment-verification'
import { overrideVerification, runVerification } from './fmcsa-service'

/**
 * Server actions for the verification domain.
 *
 * Thin `defineAction` wrappers: validation, a `resource()` resolver pinned to
 * the record's real carrier/equipment (never a client-supplied one), the
 * service call, and the audit event the architecture requires for every
 * override.
 */

/* ── FMCSA ───────────────────────────────────────────────────────────────── */

const carrierIdInput = z.object({ carrierId: uuidSchema })

async function carrierResource(input: { carrierId: string }, ctx: { actor: Actor }): Promise<ResourceContext> {
  return { tenantId: ctx.actor.tenantId, carrierId: input.carrierId }
}

export const runCarrierFmcsaVerification = defineAction({
  name: 'verification.fmcsa.run',
  permission: 'carrier:verification:run',
  input: carrierIdInput,
  resource: carrierResource,
  handler: async (input, ctx) => {
    const carrier = await ctx.db.requireById(carriers, input.carrierId, 'carrier')
    return runVerification(ctx.db, carrier, { actorUserId: ctx.actor.userId })
  },
})

const overrideFmcsaVerificationInput = z.object({
  carrierId: uuidSchema,
  verificationId: uuidSchema,
  reason: reasonSchema,
})

export const overrideCarrierFmcsaVerification = defineAction({
  name: 'verification.fmcsa.override',
  permission: 'carrier:verification:override',
  input: overrideFmcsaVerificationInput,
  resource: carrierResource,
  handler: (input, ctx) =>
    overrideVerification(ctx.db, { userId: ctx.actor.userId }, input.verificationId, input.reason),
  audit: (input, output) => ({
    action: 'verification.override',
    entityType: 'fmcsaVerification',
    entityId: output.id,
    reason: input.reason,
    metadata: { carrierId: input.carrierId },
  }),
})

/* ── Equipment COI/VIN ───────────────────────────────────────────────────── */

const equipmentIdentityInput = z.object({
  equipmentType: z.enum(['truck', 'trailer']),
  equipmentId: uuidSchema,
})

async function equipmentResource(
  input: { equipmentType: 'truck' | 'trailer'; equipmentId: string },
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  return {
    tenantId: ctx.actor.tenantId,
    ...(input.equipmentType === 'truck' ? { truckId: input.equipmentId } : { trailerId: input.equipmentId }),
  }
}

const runEquipmentVerificationInput = equipmentIdentityInput.extend({ carrierId: uuidSchema })

export const runEquipmentCoiVerification = defineAction({
  name: 'verification.equipment.run',
  permission: 'equipment:update',
  input: runEquipmentVerificationInput,
  resource: equipmentResource,
  handler: (input, ctx) => verifyEquipmentAgainstCoi(ctx.db, input),
})

const overrideEquipmentVerificationInput = equipmentIdentityInput.extend({
  verificationId: uuidSchema,
  reason: reasonSchema,
})

export const overrideEquipmentCoiVerification = defineAction({
  name: 'verification.equipment.override',
  permission: 'equipment:verification:override',
  input: overrideEquipmentVerificationInput,
  resource: equipmentResource,
  handler: (input, ctx) =>
    overrideEquipmentVerification(ctx.db, { userId: ctx.actor.userId }, input.verificationId, input.reason),
  audit: (input, output) => ({
    action: 'verification.override',
    entityType: 'equipmentVerification',
    entityId: output.id,
    reason: input.reason,
    metadata: { equipmentType: input.equipmentType, equipmentId: input.equipmentId },
  }),
})
