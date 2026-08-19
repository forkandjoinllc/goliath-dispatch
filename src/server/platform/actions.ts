'use server'

import { z } from 'zod'
import type { SaasPlan, Tenant } from '@/db/schema'
import { authorize } from '@/lib/permissions'
import { AppError, isAppError } from '@/lib/errors'
import { getRequestMeta, requireActor } from '@/server/context'
import { openTenantSupportAccess } from '@/server/auth/impersonation'
import type { ActionResult } from '@/server/action'
import { suspendTenant, reactivateTenant } from './tenants'
import { createPlan, updatePlan, type UpsertPlanInput } from './plans'

/**
 * Platform Super Admin console actions.
 *
 * These are cross-tenant by nature, so they cannot go through
 * `defineAction` (which hard-requires the actor's *currently selected*
 * tenant, irrelevant here — a Super Admin acting on tenant B while their
 * session happens to be switched into tenant A is exactly the normal case).
 * Each action instead follows the same hand-rolled shape as
 * `startImpersonationAction` in `src/server/auth/actions.ts`: resolve the
 * actor, check the specific `platform:*` permission, call the
 * `src/server/platform/**` service function (which does the write and the
 * audit), and translate a thrown `AppError` into the client-safe shape.
 */

function fail<T>(messageKey: string, code: AppError['code'] = 'validation_failed'): ActionResult<T> {
  return { ok: false, error: { code, messageKey, params: {} } }
}

function flatten(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root'
    out[path] = [...(out[path] ?? []), issue.message]
  }
  return out
}

function validationFailure<T>(error: z.ZodError): ActionResult<T> {
  return {
    ok: false,
    error: { code: 'validation_failed', messageKey: 'errors.validationFailed', params: {} },
    fieldErrors: flatten(error),
  }
}

const reasonInput = z.object({ tenantId: z.string().uuid(), reason: z.string().trim().min(10).max(2000) })

export async function suspendTenantAction(raw: unknown): Promise<ActionResult<Tenant>> {
  const actor = await requireActor()
  const request = await getRequestMeta()
  const parsed = reasonInput.safeParse(raw)
  if (!parsed.success) return validationFailure(parsed.error)

  try {
    authorize(actor, 'platform:tenant:suspend', { tenantId: parsed.data.tenantId })
    const tenant = await suspendTenant(actor, request, parsed.data.tenantId, parsed.data.reason)
    return { ok: true, data: tenant }
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.toClient() }
    return fail('errors.internal', 'internal')
  }
}

export async function reactivateTenantAction(raw: unknown): Promise<ActionResult<Tenant>> {
  const actor = await requireActor()
  const request = await getRequestMeta()
  const parsed = reasonInput.safeParse(raw)
  if (!parsed.success) return validationFailure(parsed.error)

  try {
    authorize(actor, 'platform:tenant:suspend', { tenantId: parsed.data.tenantId })
    const tenant = await reactivateTenant(actor, request, parsed.data.tenantId, parsed.data.reason)
    return { ok: true, data: tenant }
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.toClient() }
    return fail('errors.internal', 'internal')
  }
}

/**
 * Opens an explicit, audited "I am looking at this tenant's data for
 * support" session (`tenant.accessed`). This does not itself impersonate a
 * user — for the Super Admin's own view into the tenant afterward, the
 * existing tenant switcher (`switchTenantAction`) or, to act as a specific
 * user, `startImpersonationAction` (which opens this same support-access
 * step automatically for a cross-tenant target) is the follow-on step.
 */
const supportAccessInput = z.object({ tenantId: z.string().uuid(), reason: z.string().trim().min(10).max(2000) })

export async function openTenantSupportAccessAction(raw: unknown): Promise<ActionResult<{ opened: true }>> {
  const parsed = supportAccessInput.safeParse(raw)
  if (!parsed.success) return validationFailure(parsed.error)

  try {
    await openTenantSupportAccess(parsed.data.tenantId, parsed.data.reason)
    return { ok: true, data: { opened: true } }
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.toClient() }
    return fail('errors.internal', 'internal')
  }
}

const createPlanInput = z.object({
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(1).max(120),
  nameEs: z.string().trim().min(1).max(120),
  descriptionEn: z.string().trim().max(2000).optional().nullable(),
  descriptionEs: z.string().trim().max(2000).optional().nullable(),
  monthlyPriceCents: z.number().int().min(0),
  trialDays: z.number().int().min(0).max(365).optional(),
  maxUsers: z.number().int().min(1).optional().nullable(),
  maxCarriers: z.number().int().min(1).optional().nullable(),
  maxLoadsPerMonth: z.number().int().min(1).optional().nullable(),
  features: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}) satisfies z.ZodType<UpsertPlanInput, z.ZodTypeDef, unknown>

export async function createPlanAction(raw: unknown): Promise<ActionResult<SaasPlan>> {
  const actor = await requireActor()
  const request = await getRequestMeta()
  const parsed = createPlanInput.safeParse(raw)
  if (!parsed.success) return validationFailure(parsed.error)

  try {
    authorize(actor, 'platform:plan:manage')
    const plan = await createPlan(actor, request, parsed.data)
    return { ok: true, data: plan }
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.toClient() }
    return fail('errors.internal', 'internal')
  }
}

const updatePlanInput = z.object({
  planId: z.string().uuid(),
  patch: z.object({
    nameEn: z.string().trim().min(1).max(120).optional(),
    nameEs: z.string().trim().min(1).max(120).optional(),
    descriptionEn: z.string().trim().max(2000).optional().nullable(),
    descriptionEs: z.string().trim().max(2000).optional().nullable(),
    monthlyPriceCents: z.number().int().min(0).optional(),
    trialDays: z.number().int().min(0).max(365).optional(),
    maxUsers: z.number().int().min(1).optional().nullable(),
    maxCarriers: z.number().int().min(1).optional().nullable(),
    maxLoadsPerMonth: z.number().int().min(1).optional().nullable(),
    features: z.array(z.string()).optional(),
    isPublic: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }) satisfies z.ZodType<Partial<UpsertPlanInput>, z.ZodTypeDef, unknown>,
})

export async function updatePlanAction(raw: unknown): Promise<ActionResult<SaasPlan>> {
  const actor = await requireActor()
  const request = await getRequestMeta()
  const parsed = updatePlanInput.safeParse(raw)
  if (!parsed.success) return validationFailure(parsed.error)

  try {
    authorize(actor, 'platform:plan:manage')
    const plan = await updatePlan(actor, request, parsed.data.planId, parsed.data.patch)
    return { ok: true, data: plan }
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.toClient() }
    return fail('errors.internal', 'internal')
  }
}
