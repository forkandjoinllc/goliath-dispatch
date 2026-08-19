'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import type { Actor, ResourceContext } from '@/lib/permissions'
import {
  bpsSchema,
  dotNumberSchema,
  einSchema,
  emailSchema,
  localeSchema,
  mcNumberSchema,
  phoneSchema,
  postalCodeSchema,
  reasonSchema,
  usStateSchema,
  uuidSchema,
} from '@/lib/validation'
import {
  addGroupMember,
  approveOnboarding,
  assignDispatcher,
  createCarrier,
  createGroup,
  reactivateCarrier,
  rejectOnboarding,
  removeDispatcher,
  removeGroupMember,
  setCarrierDispatchFee,
  setPrimaryDispatcher,
  submitOnboarding,
  suspendCarrier,
  transitionOnboarding,
  updateCarrier,
} from './service'

/**
 * Server actions for the carrier + onboarding domain.
 *
 * Every action is a thin `defineAction` wrapper: input validation, a
 * `resource()` resolver pinned to the carrier the action actually touches (so
 * a dispatcher's "assigned" scope is checked against the real record, never a
 * client-supplied claim), the service call, and the audit event.
 */

function tenantContext(ctx: { actor: Actor }): { tenantId: string | null } {
  return { tenantId: ctx.actor.tenantId }
}

async function carrierResource(input: { carrierId: string }, ctx: { actor: Actor }): Promise<ResourceContext> {
  return { ...tenantContext(ctx), carrierId: input.carrierId }
}

/* ── Create ──────────────────────────────────────────────────────────────── */

const createCarrierInput = z.object({
  legalName: z.string().trim().min(1).max(200),
  dba: z.string().trim().max(200).optional().nullable(),
  dotNumber: dotNumberSchema,
  mcNumber: mcNumberSchema.optional(),
  ein: einSchema,
  contactFirstName: z.string().trim().min(1).max(100),
  contactLastName: z.string().trim().min(1).max(100),
  email: emailSchema,
  phone: phoneSchema,
  website: z.string().trim().max(255).optional().nullable(),
  preferredLocale: localeSchema,
  physicalLine1: z.string().trim().max(200).optional().nullable(),
  physicalLine2: z.string().trim().max(200).optional().nullable(),
  physicalCity: z.string().trim().max(120).optional().nullable(),
  physicalState: usStateSchema.optional(),
  physicalPostalCode: postalCodeSchema.optional(),
  mailingSameAsPhysical: z.boolean(),
  mailingLine1: z.string().trim().max(200).optional().nullable(),
  mailingLine2: z.string().trim().max(200).optional().nullable(),
  mailingCity: z.string().trim().max(120).optional().nullable(),
  mailingState: usStateSchema.optional(),
  mailingPostalCode: postalCodeSchema.optional(),
  usesFactoring: z.boolean(),
  dispatchFeeBps: bpsSchema.optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const createCarrierAction = defineAction({
  name: 'carrier.create',
  permission: 'carrier:create',
  input: createCarrierInput,
  handler: (input, ctx) => createCarrier(ctx.db, ctx.actor, input),
  audit: (_input, output) => ({
    action: 'onboarding.status_changed',
    entityType: 'carrier',
    entityId: output.carrier.id,
    entityLabel: output.carrier.legalName,
    metadata: { toStatus: 'draft' },
  }),
})

/* ── Update ──────────────────────────────────────────────────────────────── */

const updateCarrierInput = createCarrierInput.omit({ dispatchFeeBps: true }).partial().extend({ carrierId: uuidSchema })

export const updateCarrierAction = defineAction({
  name: 'carrier.update',
  permission: 'carrier:update',
  input: updateCarrierInput,
  resource: (input, ctx) => carrierResource({ carrierId: input.carrierId }, ctx),
  handler: ({ carrierId, ...patch }, ctx) => updateCarrier(ctx.db, ctx.actor, carrierId, patch),
  audit: (input, output) => {
    if (output.changedFields.length === 0) return null
    return {
      action: 'settings.updated',
      entityType: 'carrier',
      entityId: input.carrierId,
      entityLabel: output.carrier.legalName,
      metadata: { changedFields: output.changedFields, dotNumberChanged: output.dotNumberChanged },
    }
  },
})

/* ── Onboarding ──────────────────────────────────────────────────────────── */

const carrierIdInput = z.object({ carrierId: uuidSchema })

export const submitCarrierOnboarding = defineAction({
  name: 'onboarding.submit',
  permission: 'carrier:onboarding:submit',
  input: carrierIdInput,
  resource: carrierResource,
  handler: (input, ctx) => submitOnboarding(ctx.db, ctx.actor, input.carrierId),
  audit: (input, output) => ({
    action: 'onboarding.status_changed',
    entityType: 'carrierOnboarding',
    entityId: output.id,
    metadata: { carrierId: input.carrierId, toStatus: output.status },
  }),
})

/** Admin/Accounting review-step transitions only — approve/reject/submit have their own actions. */
const reviewOnboardingInput = z.object({
  carrierId: uuidSchema,
  toStatus: z.enum(['under_review', 'corrections_required']),
  reason: reasonSchema.optional(),
})

export const reviewCarrierOnboarding = defineAction({
  name: 'onboarding.review',
  permission: 'carrier:onboarding:review',
  input: reviewOnboardingInput,
  resource: carrierResource,
  handler: (input, ctx) =>
    transitionOnboarding(ctx.db, ctx.actor, input.carrierId, input.toStatus, { reason: input.reason }),
  audit: (input, output) => ({
    action: 'onboarding.status_changed',
    entityType: 'carrierOnboarding',
    entityId: output.id,
    reason: input.reason,
    metadata: { carrierId: input.carrierId, toStatus: output.status },
  }),
})

export const approveCarrierOnboarding = defineAction({
  name: 'onboarding.approve',
  permission: 'carrier:onboarding:approve',
  input: carrierIdInput,
  resource: carrierResource,
  handler: (input, ctx) => approveOnboarding(ctx.db, ctx.actor, input.carrierId),
  audit: (input, output) => ({
    action: 'onboarding.status_changed',
    entityType: 'carrierOnboarding',
    entityId: output.id,
    metadata: { carrierId: input.carrierId, toStatus: output.status },
  }),
})

const rejectOnboardingInput = z.object({ carrierId: uuidSchema, reason: reasonSchema })

export const rejectCarrierOnboarding = defineAction({
  name: 'onboarding.reject',
  permission: 'carrier:onboarding:approve',
  input: rejectOnboardingInput,
  resource: carrierResource,
  handler: (input, ctx) => rejectOnboarding(ctx.db, ctx.actor, input.carrierId, input.reason),
  audit: (input, output) => ({
    action: 'onboarding.status_changed',
    entityType: 'carrierOnboarding',
    entityId: output.id,
    reason: input.reason,
    metadata: { carrierId: input.carrierId, toStatus: output.status },
  }),
})

/* ── Suspension ──────────────────────────────────────────────────────────── */

const suspendCarrierInput = z.object({ carrierId: uuidSchema, reason: reasonSchema })

export const suspendCarrierAction = defineAction({
  name: 'carrier.suspend',
  permission: 'carrier:onboarding:approve',
  input: suspendCarrierInput,
  resource: carrierResource,
  handler: (input, ctx) => suspendCarrier(ctx.db, ctx.actor, input.carrierId, input.reason),
  audit: (input, output) => ({
    action: 'onboarding.status_changed',
    entityType: 'carrier',
    entityId: output.id,
    reason: input.reason,
    metadata: { toStatus: 'suspended' },
  }),
})

export const reactivateCarrierAction = defineAction({
  name: 'carrier.reactivate',
  permission: 'carrier:onboarding:approve',
  input: suspendCarrierInput,
  resource: carrierResource,
  handler: (input, ctx) => reactivateCarrier(ctx.db, ctx.actor, input.carrierId, input.reason),
  audit: (input, output) => ({
    action: 'onboarding.status_changed',
    entityType: 'carrier',
    entityId: output.id,
    reason: input.reason,
    metadata: { toStatus: 'approved' },
  }),
})

/* ── Dispatcher assignment ───────────────────────────────────────────────── */

const dispatcherAssignmentInput = z.object({
  carrierId: uuidSchema,
  dispatcherUserId: uuidSchema,
  reason: z.string().trim().max(500).optional().nullable(),
})

export const assignCarrierDispatcher = defineAction({
  name: 'carrier.assignDispatcher',
  permission: 'assignment:manage',
  input: dispatcherAssignmentInput,
  resource: carrierResource,
  handler: (input, ctx) => assignDispatcher(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'permission.changed',
    entityType: 'carrierDispatcherAssignment',
    entityId: output.id,
    reason: input.reason ?? undefined,
    metadata: { carrierId: input.carrierId, dispatcherUserId: input.dispatcherUserId, action: 'assigned' },
  }),
})

export const removeCarrierDispatcher = defineAction({
  name: 'carrier.removeDispatcher',
  permission: 'assignment:manage',
  input: dispatcherAssignmentInput,
  resource: carrierResource,
  handler: (input, ctx) => removeDispatcher(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'permission.changed',
    entityType: 'carrierDispatcherAssignment',
    entityId: output[0]?.id,
    reason: input.reason ?? undefined,
    metadata: { carrierId: input.carrierId, dispatcherUserId: input.dispatcherUserId, action: 'removed' },
  }),
})

export const setPrimaryCarrierDispatcher = defineAction({
  name: 'carrier.setPrimaryDispatcher',
  permission: 'assignment:manage',
  input: dispatcherAssignmentInput,
  resource: carrierResource,
  handler: (input, ctx) => setPrimaryDispatcher(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'permission.changed',
    entityType: 'carrierDispatcherAssignment',
    entityId: output.id,
    reason: input.reason ?? undefined,
    metadata: { carrierId: input.carrierId, dispatcherUserId: input.dispatcherUserId, action: 'set_primary' },
  }),
})

/* ── Financial ───────────────────────────────────────────────────────────── */

const setDispatchFeeInput = z.object({ carrierId: uuidSchema, dispatchFeeBps: bpsSchema, reason: reasonSchema })

export const setCarrierDispatchFeeAction = defineAction({
  name: 'carrier.setDispatchFee',
  permission: 'carrier:fee:update',
  input: setDispatchFeeInput,
  resource: carrierResource,
  handler: (input, ctx) => setCarrierDispatchFee(ctx.db, input.carrierId, input.dispatchFeeBps),
  audit: (input, output) => ({
    action: 'financial.changed',
    entityType: 'carrier',
    entityId: output.id,
    reason: input.reason,
    metadata: { field: 'dispatchFeeBps', value: input.dispatchFeeBps },
  }),
})

/* ── Groups ──────────────────────────────────────────────────────────────── */

const createGroupInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
})

export const createDispatcherGroup = defineAction({
  name: 'group.create',
  permission: 'assignment:manage',
  input: createGroupInput,
  handler: (input, ctx) => createGroup(ctx.db, ctx.actor, input),
  audit: (_input, output) => ({
    action: 'permission.changed',
    entityType: 'dispatcherGroup',
    entityId: output.id,
    metadata: { action: 'group_created' },
  }),
})

const groupMemberInput = z.object({
  groupId: uuidSchema,
  memberType: z.enum(['carrier', 'truck', 'trailer', 'driver']),
  memberId: uuidSchema,
})

export const addDispatcherGroupMember = defineAction({
  name: 'group.addMember',
  permission: 'assignment:manage',
  input: groupMemberInput,
  resource: (input, ctx) => ({ ...tenantContext(ctx), groupId: input.groupId }),
  handler: (input, ctx) => addGroupMember(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'permission.changed',
    entityType: 'groupMember',
    entityId: output.id,
    metadata: { groupId: input.groupId, memberType: input.memberType, memberId: input.memberId, action: 'added' },
  }),
})

const removeGroupMemberInput = groupMemberInput.extend({ reason: z.string().trim().max(500).optional().nullable() })

export const removeDispatcherGroupMember = defineAction({
  name: 'group.removeMember',
  permission: 'assignment:manage',
  input: removeGroupMemberInput,
  resource: (input, ctx) => ({ ...tenantContext(ctx), groupId: input.groupId }),
  handler: (input, ctx) => removeGroupMember(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'permission.changed',
    entityType: 'groupMember',
    entityId: output.id,
    reason: input.reason ?? undefined,
    metadata: { groupId: input.groupId, memberType: input.memberType, memberId: input.memberId, action: 'removed' },
  }),
})
