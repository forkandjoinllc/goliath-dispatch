'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import type { Actor } from '@/lib/permissions'
import { reasonSchema, uuidSchema } from '@/lib/validation'
import { grantDispatcherResource, renameGroup, revokeDispatcherResource, setGroupActive } from './service'

/**
 * Server actions for dispatcher resource grants and group lifecycle.
 *
 * `assignment:manage` is Admin-only in the role matrix (see
 * `lib/permissions/catalog.ts`) — every action below relies on exactly that
 * permission, never a role-name comparison. Carrier↔dispatcher assignment and
 * group creation/membership actions already exist in
 * `server/carriers/actions.ts` (`assignCarrierDispatcher`,
 * `setPrimaryCarrierDispatcher`, `createDispatcherGroup`,
 * `addDispatcherGroupMember`, `removeDispatcherGroupMember`); the assignments
 * screens import those directly rather than duplicating them here.
 */

function tenantContext(ctx: { actor: Actor }) {
  return { tenantId: ctx.actor.tenantId }
}

const resourceTypeSchema = z.enum(['truck', 'trailer', 'driver', 'group'])

const grantInput = z.object({
  dispatcherUserId: uuidSchema,
  resourceType: resourceTypeSchema,
  resourceId: uuidSchema,
  reason: z.string().trim().max(500).optional().nullable(),
})

export const grantDispatcherResourceAction = defineAction({
  name: 'assignment.resource.grant',
  permission: 'assignment:manage',
  input: grantInput,
  resource: (input, ctx) => ({ ...tenantContext(ctx), dispatcherUserId: input.dispatcherUserId }),
  handler: (input, ctx) => grantDispatcherResource(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'permission.changed',
    entityType: 'dispatcherResourceAssignment',
    entityId: output.id,
    reason: input.reason ?? undefined,
    metadata: {
      dispatcherUserId: input.dispatcherUserId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: 'granted',
    },
  }),
})

const revokeInput = grantInput

export const revokeDispatcherResourceAction = defineAction({
  name: 'assignment.resource.revoke',
  permission: 'assignment:manage',
  input: revokeInput,
  resource: (input, ctx) => ({ ...tenantContext(ctx), dispatcherUserId: input.dispatcherUserId }),
  handler: (input, ctx) => revokeDispatcherResource(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'permission.changed',
    entityType: 'dispatcherResourceAssignment',
    entityId: output[0]?.id,
    reason: input.reason ?? undefined,
    metadata: {
      dispatcherUserId: input.dispatcherUserId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: 'revoked',
    },
  }),
})

/* ── Groups: rename / deactivate ─────────────────────────────────────────── */

const renameGroupInput = z.object({ groupId: uuidSchema, name: z.string().trim().min(1).max(120) })

export const renameGroupAction = defineAction({
  name: 'assignment.group.rename',
  permission: 'assignment:manage',
  input: renameGroupInput,
  resource: (input, ctx) => ({ ...tenantContext(ctx), groupId: input.groupId }),
  handler: (input, ctx) => renameGroup(ctx.db, ctx.actor, input.groupId, input.name),
  audit: (input, output) => ({
    action: 'permission.changed',
    entityType: 'dispatcherGroup',
    entityId: output.id,
    metadata: { action: 'renamed', name: input.name },
  }),
})

const setGroupActiveInput = z.object({ groupId: uuidSchema, active: z.boolean(), reason: reasonSchema.optional() })

export const setGroupActiveAction = defineAction({
  name: 'assignment.group.setActive',
  permission: 'assignment:manage',
  input: setGroupActiveInput,
  resource: (input, ctx) => ({ ...tenantContext(ctx), groupId: input.groupId }),
  handler: (input, ctx) => setGroupActive(ctx.db, ctx.actor, input.groupId, input.active),
  audit: (input, output) => ({
    action: 'permission.changed',
    entityType: 'dispatcherGroup',
    entityId: output.id,
    reason: input.reason,
    metadata: { action: input.active ? 'activated' : 'deactivated' },
  }),
})
