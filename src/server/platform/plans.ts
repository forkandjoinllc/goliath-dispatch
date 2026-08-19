import 'server-only'
import { desc, eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { saasPlans, type SaasPlan } from '@/db/schema'
import type { Actor } from '@/lib/permissions'
import { recordAudit, diffRecords, type AuditRequestContext } from '@/lib/audit'
import { notFound } from '@/lib/errors'

/** SaaS plan CRUD for the Platform console (`platform:plan:manage`). */

export async function listAllPlans(): Promise<SaasPlan[]> {
  return unsafeDb.select().from(saasPlans).orderBy(saasPlans.sortOrder, desc(saasPlans.createdAt))
}

export interface UpsertPlanInput {
  code: string
  nameEn: string
  nameEs: string
  descriptionEn?: string | null
  descriptionEs?: string | null
  monthlyPriceCents: number
  trialDays?: number
  maxUsers?: number | null
  maxCarriers?: number | null
  maxLoadsPerMonth?: number | null
  features?: string[]
  isPublic?: boolean
  sortOrder?: number
}

export async function createPlan(
  actor: Actor,
  request: AuditRequestContext,
  input: UpsertPlanInput,
): Promise<SaasPlan> {
  const [plan] = await unsafeDb.insert(saasPlans).values(input).returning()
  await recordAudit(actor, request, {
    action: 'settings.updated',
    entityType: 'saas_plan',
    entityId: plan!.id,
    entityLabel: plan!.nameEn,
    after: input as unknown as Record<string, unknown>,
  })
  return plan!
}

export async function updatePlan(
  actor: Actor,
  request: AuditRequestContext,
  planId: string,
  input: Partial<UpsertPlanInput>,
): Promise<SaasPlan> {
  const [before] = await unsafeDb.select().from(saasPlans).where(eq(saasPlans.id, planId)).limit(1)
  if (!before) throw notFound('errors.notFound')

  const [after] = await unsafeDb.update(saasPlans).set(input).where(eq(saasPlans.id, planId)).returning()

  const diff = diffRecords(before as unknown as Record<string, unknown>, input as Record<string, unknown>)
  await recordAudit(actor, request, {
    action: 'settings.updated',
    entityType: 'saas_plan',
    entityId: planId,
    entityLabel: after!.nameEn,
    before: diff.before,
    after: diff.after,
  })

  return after!
}
