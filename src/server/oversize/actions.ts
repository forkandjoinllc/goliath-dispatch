'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { tenantDb } from '@/db/tenant-db'
import { oversizeEvaluations } from '@/db/schema'
import type { Actor, ResourceContext } from '@/lib/permissions'
import { uuidSchema } from '@/lib/validation'
import { getLoadResourceContext } from '@/server/loads/queries'
import { runEvaluation, validateEvaluation } from './service'
import { updateOversizeRule } from './rules'

/**
 * Server actions for the oversize domain. Every input flows through
 * `defineAction`: permission check, tenant-scoped `TenantDb`, audit. The
 * business logic itself lives in `evaluate.ts` (pure) and `service.ts`
 * (persistence) — nothing here computes an outcome.
 */

function tenantDbFor(actor: Actor) {
  if (!actor.tenantId) throw new Error('resource resolver requires a tenant-scoped actor')
  return tenantDb(actor.tenantId)
}

async function loadResource(input: { loadId: string }, ctx: { actor: Actor }): Promise<ResourceContext> {
  return getLoadResourceContext(tenantDbFor(ctx.actor), input.loadId, ctx.actor)
}

async function evaluationResource(
  input: { evaluationId: string; loadId: string },
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  const db = tenantDbFor(ctx.actor)
  const evaluation = await db.findById(oversizeEvaluations, input.evaluationId)
  if (!evaluation || evaluation.loadId !== input.loadId) {
    return { tenantId: ctx.actor.tenantId }
  }
  return getLoadResourceContext(db, evaluation.loadId, ctx.actor)
}

/* ── Run evaluation ──────────────────────────────────────────────────────── */

const runEvaluationInput = z.object({
  loadId: uuidSchema,
  axleWeightPounds: z.number().int().positive().max(200_000).optional().nullable(),
  axleConfiguration: z.string().trim().max(60).optional().nullable(),
})

export const runOversizeEvaluationAction = defineAction({
  name: 'oversize.evaluate',
  permission: 'oversize:evaluate',
  input: runEvaluationInput,
  resource: loadResource,
  handler: (input, ctx) =>
    runEvaluation(ctx.db, input.loadId, {
      axleWeightPounds: input.axleWeightPounds ?? null,
      axleConfiguration: input.axleConfiguration ?? null,
    }),
  audit: (input, output) => ({
    action: 'load.assignment_changed',
    entityType: 'oversizeEvaluation',
    entityId: output.id,
    metadata: { action: 'oversize_evaluated', outcome: output.outcome, loadId: input.loadId },
  }),
})

/* ── Validate evaluation ─────────────────────────────────────────────────── */

const validateEvaluationInput = z.object({
  loadId: uuidSchema,
  evaluationId: uuidSchema,
  status: z.enum(['validated', 'rejected']),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const validateOversizeEvaluationAction = defineAction({
  name: 'oversize.validate',
  permission: 'oversize:validate',
  input: validateEvaluationInput,
  resource: evaluationResource,
  handler: (input, ctx) =>
    validateEvaluation(ctx.db, ctx.actor, input.evaluationId, { status: input.status, notes: input.notes }),
  audit: (input, output) => ({
    action: 'load.assignment_changed',
    entityType: 'oversizeEvaluation',
    entityId: output.id,
    metadata: { action: 'oversize_validated', status: input.status, loadId: input.loadId },
  }),
})

/* ── Rule management ─────────────────────────────────────────────────────── */

const curfewWindowSchema = z.object({ start: z.string(), end: z.string(), note: z.string().optional() })

const updateRuleInput = z.object({
  ruleId: uuidSchema,
  maxWidthInches: z.number().int().positive().max(300).optional(),
  maxHeightInches: z.number().int().positive().max(300).optional(),
  maxLengthInches: z.number().int().positive().max(2000).optional(),
  maxGrossWeightPounds: z.number().int().positive().max(500_000).optional(),
  maxAxleWeightPounds: z.number().int().positive().max(100_000).optional(),
  escortWidthThresholdInches: z.number().int().positive().max(300).optional().nullable(),
  escortHeightThresholdInches: z.number().int().positive().max(300).optional().nullable(),
  escortLengthThresholdInches: z.number().int().positive().max(2000).optional().nullable(),
  policeEscortWidthThresholdInches: z.number().int().positive().max(300).optional().nullable(),
  nightTravelProhibited: z.boolean().optional(),
  weekendTravelProhibited: z.boolean().optional(),
  holidayTravelProhibited: z.boolean().optional(),
  curfewWindows: z.array(curfewWindowSchema).optional(),
  permitRequiredAboveLegal: z.boolean().optional(),
  permitAuthorityName: z.string().trim().max(200).optional().nullable(),
  permitAuthorityUrl: z.string().trim().max(255).optional().nullable(),
  sourceNoteEn: z.string().trim().max(4000).optional(),
  sourceNoteEs: z.string().trim().max(4000).optional(),
  travelRestrictionsNoteEn: z.string().trim().max(2000).optional(),
  travelRestrictionsNoteEs: z.string().trim().max(2000).optional(),
})

async function ruleResource(_input: unknown, ctx: { actor: Actor }): Promise<ResourceContext> {
  return { tenantId: ctx.actor.tenantId }
}

export const updateOversizeRuleAction = defineAction({
  name: 'oversize.rule.update',
  permission: 'oversize:rule:manage',
  input: updateRuleInput,
  resource: ruleResource,
  handler: ({ ruleId, ...input }, ctx) => updateOversizeRule(ctx.db, ruleId, input),
  audit: (_input, output) => ({
    action: 'settings.updated',
    entityType: 'oversizeRule',
    entityId: output.id,
    entityLabel: output.stateCode,
    metadata: { action: 'oversize_rule_updated', stateCode: output.stateCode },
  }),
})
