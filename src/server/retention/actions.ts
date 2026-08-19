'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import type { LegalHold } from '@/db/schema'
import { applyLegalHold, releaseLegalHold } from './legal-holds'
import { RETENTION_ENTITY_TYPES } from './policy'

/**
 * Legal hold administration actions. Both require `retention:manage`
 * (tenant scope only — see `src/lib/permissions/catalog.ts`), and the
 * mandatory-reason / audit guarantees live in `legal-holds.ts` itself so
 * they hold regardless of which caller reaches it.
 */

const applyLegalHoldInput = z.object({
  name: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(10).max(2000),
  scopeType: z.enum(['tenant', 'entity_type', 'record']),
  entityType: z.enum(RETENTION_ENTITY_TYPES as unknown as [string, ...string[]]).optional(),
  entityId: z.string().uuid().optional(),
  matterReference: z.string().trim().max(200).optional(),
})

export const applyLegalHoldAction = defineAction<z.infer<typeof applyLegalHoldInput>, LegalHold>({
  name: 'retention.legalHold.apply',
  permission: 'retention:manage',
  input: applyLegalHoldInput,
  handler: async (input, ctx) => applyLegalHold(ctx.db, ctx.actor, ctx.request, input),
})

const releaseLegalHoldInput = z.object({
  legalHoldId: z.string().uuid(),
  releaseReason: z.string().trim().min(10).max(2000),
})

export const releaseLegalHoldAction = defineAction<z.infer<typeof releaseLegalHoldInput>, LegalHold>({
  name: 'retention.legalHold.release',
  permission: 'retention:manage',
  input: releaseLegalHoldInput,
  handler: async (input, ctx) => releaseLegalHold(ctx.db, ctx.actor, ctx.request, input),
})
