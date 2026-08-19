'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { tenantDb } from '@/db/tenant-db'
import { carrierSettlements } from '@/db/schema'
import { getTenant } from '@/server/context'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { getStorage } from '@/lib/storage'
import type { Actor, ResourceContext } from '@/lib/permissions'
import { reasonSchema, uuidSchema } from '@/lib/validation'
import { tenantBranding } from '@/db/schema'
import {
  generateSettlementForPeriod,
  issueSettlement,
  markSettlementPaid,
  recordFactoringSubmission,
  voidSettlement,
} from './service'

function tenantContext(ctx: { actor: Actor }): { tenantId: string | null } {
  return { tenantId: ctx.actor.tenantId }
}

async function settlementResource(
  input: { settlementId: string },
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  const base = tenantContext(ctx)
  if (!ctx.actor.tenantId) return base
  const settlement = await tenantDb(ctx.actor.tenantId).findById(carrierSettlements, input.settlementId)
  return { ...base, carrierId: settlement?.carrierId ?? null }
}

/* ── Generate ─────────────────────────────────────────────────────────────── */

const generateSettlementInput = z.object({
  carrierId: uuidSchema,
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
  factoringCompanyId: uuidSchema.optional(),
})

export const generateSettlementAction = defineAction({
  name: 'settlement.generate',
  permission: 'settlement:manage',
  input: generateSettlementInput,
  handler: (input, ctx) =>
    generateSettlementForPeriod(ctx.db, {
      carrierId: input.carrierId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      notes: input.notes ?? null,
      factoringCompanyId: input.factoringCompanyId ?? null,
    }),
  audit: (input, output) => ({
    action: 'financial.changed',
    entityType: 'carrierSettlement',
    entityId: output.settlement.id,
    entityLabel: output.settlement.settlementNumber,
    metadata: { carrierId: input.carrierId, lineCount: output.lines.length },
  }),
})

/* ── Issue ────────────────────────────────────────────────────────────────── */

const settlementIdInput = z.object({ settlementId: uuidSchema })

export const issueSettlementAction = defineAction({
  name: 'settlement.issue',
  permission: 'settlement:manage',
  input: settlementIdInput,
  resource: (input, ctx) => settlementResource(input, ctx),
  handler: async (input, ctx) => {
    const tenant = await getTenant(ctx.actor.tenantId)
    const branding = await ctx.db.findFirst(tenantBranding)

    let logoPngBytes: Uint8Array | undefined
    if (branding?.logoStorageKey) {
      try {
        const stored = await getStorage().get(branding.logoStorageKey)
        if (stored.contentType === 'image/png') logoPngBytes = stored.body
      } catch {
        // Branding is decorative; a missing/unreadable logo must never block issuing.
      }
    }

    const dictionary = await getDictionary(ctx.actor.locale, ['finance', 'document', 'common'])
    const t = createTranslator(dictionary, ctx.actor.locale)

    return issueSettlement(
      ctx.db,
      ctx.actor,
      input.settlementId,
      {
        tenantName: tenant?.displayName ?? 'Goliath Dispatch',
        tenantAddressLines: [tenant?.legalName ?? tenant?.displayName ?? 'Goliath Dispatch'],
        timezone: tenant?.defaultTimezone ?? 'America/New_York',
        logoPngBytes,
      },
      ctx.actor.locale,
      t,
    )
  },
  audit: (_input, output) => ({
    action: 'financial.changed',
    entityType: 'carrierSettlement',
    entityId: output.id,
    entityLabel: output.settlementNumber,
    metadata: { toStatus: output.status },
  }),
})

export const markSettlementPaidAction = defineAction({
  name: 'settlement.markPaid',
  permission: 'settlement:manage',
  input: settlementIdInput,
  resource: (input, ctx) => settlementResource(input, ctx),
  handler: (input, ctx) => markSettlementPaid(ctx.db, input.settlementId),
  audit: (_input, output) => ({
    action: 'financial.changed',
    entityType: 'carrierSettlement',
    entityId: output.id,
    entityLabel: output.settlementNumber,
    metadata: { toStatus: output.status },
  }),
})

const voidSettlementInput = z.object({ settlementId: uuidSchema, reason: reasonSchema })

export const voidSettlementAction = defineAction({
  name: 'settlement.void',
  permission: 'settlement:manage',
  input: voidSettlementInput,
  resource: (input, ctx) => settlementResource(input, ctx),
  handler: (input, ctx) => voidSettlement(ctx.db, input.settlementId, input.reason),
  audit: (input, output) => ({
    action: 'financial.changed',
    entityType: 'carrierSettlement',
    entityId: output.id,
    entityLabel: output.settlementNumber,
    reason: input.reason,
    metadata: { toStatus: output.status },
  }),
})

const recordFactoringSubmissionInput = z.object({
  settlementId: uuidSchema,
  factoringCompanyId: uuidSchema,
})

/** Records that this settlement's proceeds were manually submitted to the factor — no API call happens. */
export const recordFactoringSubmissionAction = defineAction({
  name: 'settlement.recordFactoringSubmission',
  permission: 'settlement:manage',
  input: recordFactoringSubmissionInput,
  resource: (input, ctx) => settlementResource(input, ctx),
  handler: (input, ctx) => recordFactoringSubmission(ctx.db, input.settlementId, input.factoringCompanyId),
  audit: (input, output) => ({
    action: 'financial.changed',
    entityType: 'carrierSettlement',
    entityId: output.id,
    entityLabel: output.settlementNumber,
    reason: 'submitted to factoring company (manual)',
    metadata: { factoringCompanyId: input.factoringCompanyId },
  }),
})
