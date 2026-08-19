'use server'

import { z } from 'zod'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { defineAction } from '@/server/action'
import { tenantDb } from '@/db/tenant-db'
import { driverCarrierRelationships, driverStatusEnum, drivers } from '@/db/schema'
import { emailSchema, phoneSchema, reasonSchema, uuidSchema, usStateSchema } from '@/lib/validation'
import type { Actor, ResourceContext } from '@/lib/permissions'
import {
  addDriverCarrierRelationship,
  createDriver,
  endDriverCarrierRelationship,
  inviteDriverUser,
  linkExistingUserToDriver,
  revokeDriverInvitation,
  reviewDriverLicense,
  setDriverStatus,
  setPrimaryCarrierForDriver,
  unlinkDriverUser,
  updateDriver,
} from './service'

/**
 * Server actions for the driver domain.
 *
 * Every action resolves `resource()` from the real database row — never a
 * client-supplied carrier claim — exactly as `server/equipment/actions.ts`
 * does. Because a driver's carrier link is many-to-many, `driverResource`
 * only reports a `carrierId` scoping fact when an active relationship to the
 * *acting* carrier user's own carrier genuinely exists.
 */

function tenantDbFor(actor: Actor) {
  if (!actor.tenantId) throw new Error('resource resolver requires a tenant-scoped actor')
  return tenantDb(actor.tenantId)
}

async function driverResource(input: { driverId: string }, ctx: { actor: Actor }): Promise<ResourceContext> {
  const db = tenantDbFor(ctx.actor)
  const driver = await db.findById(drivers, input.driverId)

  let carrierId: string | null = null
  if (ctx.actor.carrierId) {
    const now = new Date()
    const hasRelationship = await db.exists(
      driverCarrierRelationships,
      and(
        eq(driverCarrierRelationships.driverId, input.driverId),
        eq(driverCarrierRelationships.carrierId, ctx.actor.carrierId),
        or(isNull(driverCarrierRelationships.endDate), gt(driverCarrierRelationships.endDate, now))!,
      )!,
    )
    if (hasRelationship) carrierId = ctx.actor.carrierId
  }

  return {
    tenantId: ctx.actor.tenantId,
    driverId: input.driverId,
    carrierId,
    ownerUserId: driver?.userId ?? undefined,
  }
}

/* ── Create ──────────────────────────────────────────────────────────────── */

const endorsementsSchema = z.array(z.string().trim().min(1).max(10)).max(10).optional()
const restrictionsSchema = z.array(z.string().trim().min(1).max(10)).max(10).optional()

const createDriverInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  dateOfBirth: z.string().trim().optional().nullable(),
  email: emailSchema.optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  preferredLocale: z.enum(['en', 'es']),
  licenseState: usStateSchema.optional().nullable(),
  licenseNumber: z.string().trim().min(1).max(40).optional().nullable(),
  cdlClass: z.string().trim().max(4).optional().nullable(),
  endorsements: endorsementsSchema,
  restrictions: restrictionsSchema,
  licenseExpiresAt: z.coerce.date().optional().nullable(),
  medicalCardExpiresAt: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const createDriverAction = defineAction({
  name: 'driver.create',
  permission: 'driver:create',
  input: createDriverInput,
  handler: (input, ctx) => createDriver(ctx.db, ctx.actor, input),
})

/* ── Update ──────────────────────────────────────────────────────────────── */

const updateDriverInput = createDriverInput.partial().extend({ driverId: uuidSchema })

export const updateDriverAction = defineAction({
  name: 'driver.update',
  permission: 'driver:update',
  input: updateDriverInput,
  resource: (input, ctx) => driverResource({ driverId: input.driverId }, ctx),
  handler: ({ driverId, ...patch }, ctx) => updateDriver(ctx.db, ctx.actor, driverId, patch),
})

const setDriverStatusInput = z.object({ driverId: uuidSchema, status: z.enum(driverStatusEnum.enumValues) })

export const setDriverStatusAction = defineAction({
  name: 'driver.status.set',
  permission: 'driver:update',
  input: setDriverStatusInput,
  resource: (input, ctx) => driverResource({ driverId: input.driverId }, ctx),
  handler: (input, ctx) => setDriverStatus(ctx.db, ctx.actor, input.driverId, input.status),
})

/* ── Licence review ──────────────────────────────────────────────────────── */

const reviewLicenseInput = z.object({
  driverId: uuidSchema,
  status: z.enum(['verified', 'failed']),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const reviewDriverLicenseAction = defineAction({
  name: 'driver.license.review',
  permission: 'driver:approve',
  input: reviewLicenseInput,
  resource: (input, ctx) => driverResource({ driverId: input.driverId }, ctx),
  handler: (input, ctx) => reviewDriverLicense(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'document.approved',
    entityType: 'driver',
    entityId: output.id,
    reason: input.notes ?? undefined,
    metadata: { field: 'licenseReview', status: input.status },
  }),
})

/* ── Carrier relationships ───────────────────────────────────────────────── */

const relationshipInput = z.object({ driverId: uuidSchema, carrierId: uuidSchema, isPrimary: z.boolean().optional() })

export const addDriverCarrierRelationshipAction = defineAction({
  name: 'driver.carrier.add',
  permission: 'driver:update',
  input: relationshipInput,
  resource: (input, ctx) => driverResource({ driverId: input.driverId }, ctx),
  handler: (input, ctx) => addDriverCarrierRelationship(ctx.db, ctx.actor, input),
})

const endRelationshipInput = z.object({
  driverId: uuidSchema,
  carrierId: uuidSchema,
  reason: reasonSchema.optional(),
})

export const endDriverCarrierRelationshipAction = defineAction({
  name: 'driver.carrier.end',
  permission: 'driver:update',
  input: endRelationshipInput,
  resource: (input, ctx) => driverResource({ driverId: input.driverId }, ctx),
  handler: (input, ctx) => endDriverCarrierRelationship(ctx.db, ctx.actor, input),
})

export const setPrimaryCarrierForDriverAction = defineAction({
  name: 'driver.carrier.setPrimary',
  permission: 'driver:update',
  input: relationshipInput,
  resource: (input, ctx) => driverResource({ driverId: input.driverId }, ctx),
  handler: (input, ctx) => setPrimaryCarrierForDriver(ctx.db, ctx.actor, input),
})

/* ── Portal access ────────────────────────────────────────────────────────── */

const inviteDriverUserInput = z.object({
  driverId: uuidSchema,
  email: emailSchema,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
})

/**
 * A Carrier user may do this for their own drivers, an Admin for any —
 * `driverResource` only reports a `carrierId` scoping fact when an active
 * relationship between the acting carrier and this driver genuinely exists,
 * so `tenant:user:invite`'s `carrier` scope can never be satisfied by a
 * driver belonging to a different carrier.
 */
export const inviteDriverUserAction = defineAction({
  name: 'driver.portal.invite',
  permission: 'tenant:user:invite',
  input: inviteDriverUserInput,
  resource: (input, ctx) => driverResource({ driverId: input.driverId }, ctx),
  handler: (input, ctx) => inviteDriverUser(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'role.changed',
    entityType: 'driver',
    entityId: input.driverId,
    metadata: { operation: 'portal_invited', email: output.email },
  }),
})

/** Re-issues a fresh invitation token for a driver who has not yet accepted — same call as the initial invite. */
export const resendDriverInvitationAction = defineAction({
  name: 'driver.portal.resendInvite',
  permission: 'tenant:user:invite',
  input: inviteDriverUserInput,
  resource: (input, ctx) => driverResource({ driverId: input.driverId }, ctx),
  handler: (input, ctx) => inviteDriverUser(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'role.changed',
    entityType: 'driver',
    entityId: input.driverId,
    metadata: { operation: 'portal_invite_resent', email: output.email },
  }),
})

const driverIdInput = z.object({ driverId: uuidSchema })

export const revokeDriverInvitationAction = defineAction({
  name: 'driver.portal.revokeInvite',
  permission: 'tenant:user:invite',
  input: driverIdInput,
  resource: (input, ctx) => driverResource({ driverId: input.driverId }, ctx),
  handler: async (input, ctx) => {
    await revokeDriverInvitation(ctx.db, ctx.actor, input)
    return { driverId: input.driverId }
  },
  audit: (input) => ({
    action: 'role.changed',
    entityType: 'driver',
    entityId: input.driverId,
    metadata: { operation: 'portal_invite_revoked' },
  }),
})

const linkExistingUserInput = z.object({ driverId: uuidSchema, userId: uuidSchema })

export const linkExistingUserToDriverAction = defineAction({
  name: 'driver.portal.linkExistingUser',
  permission: 'driver:update',
  input: linkExistingUserInput,
  resource: (input, ctx) => driverResource({ driverId: input.driverId }, ctx),
  handler: (input, ctx) => linkExistingUserToDriver(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'role.changed',
    entityType: 'driver',
    entityId: output.id,
    metadata: { operation: 'portal_linked', userId: input.userId },
  }),
})

export const unlinkDriverUserAction = defineAction({
  name: 'driver.portal.unlink',
  permission: 'driver:update',
  input: driverIdInput,
  resource: (input, ctx) => driverResource({ driverId: input.driverId }, ctx),
  handler: (input, ctx) => unlinkDriverUser(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'role.changed',
    entityType: 'driver',
    entityId: output.id,
    metadata: { operation: 'portal_unlinked' },
  }),
})
