'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { tenantDb } from '@/db/tenant-db'
import type { Actor, ResourceContext } from '@/lib/permissions'
import { uuidSchema } from '@/lib/validation'
import { getLoadResourceContext } from '@/server/loads/queries'
import { calculateRoute } from './service'

/**
 * Server actions for the route domain. Thin `defineAction` wrapper around
 * `calculateRoute` — the `resource()` resolver pins the permission check to
 * the load's real carrier/dispatcher facts, matching every other load-scoped
 * action in the codebase (`loads/actions.ts`, `finance/actions.ts`).
 */

function tenantDbFor(actor: Actor) {
  if (!actor.tenantId) throw new Error('resource resolver requires a tenant-scoped actor')
  return tenantDb(actor.tenantId)
}

async function loadResource(input: { loadId: string }, ctx: { actor: Actor }): Promise<ResourceContext> {
  return getLoadResourceContext(tenantDbFor(ctx.actor), input.loadId, ctx.actor)
}

const calculateRouteInput = z.object({ loadId: uuidSchema, force: z.boolean().optional() })

export const calculateRouteAction = defineAction({
  name: 'route.calculate',
  permission: 'route:calculate',
  input: calculateRouteInput,
  resource: loadResource,
  handler: (input, ctx) => calculateRoute(ctx.db, input.loadId, { force: input.force }),
})
