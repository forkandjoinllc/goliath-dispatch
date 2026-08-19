import 'server-only'
import { and, count, desc, eq, isNull, max } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import {
  carriers,
  loads,
  saasPlans,
  tenants,
  tenantSubscriptions,
  userTenantMemberships,
  type SaasPlan,
  type Tenant,
  type TenantSubscription,
} from '@/db/schema'
import type { Actor } from '@/lib/permissions'
import { recordAudit, type AuditRequestContext } from '@/lib/audit'
import { conflict, notFound, validationFailed } from '@/lib/errors'

/**
 * Cross-tenant tenant administration for the Platform Super Admin console.
 *
 * This is the one place under `src/server/platform/**` (allow-listed in
 * `eslint.config.mjs` for `unsafeDb`) that reads and writes the `tenants`
 * row itself and aggregates across every tenant — none of it can go through
 * `tenantDb()`, which is bound to exactly one tenant. Callers (the
 * `app/platform` route tree) are responsible for calling `authorize()` with
 * the relevant `platform:*` permission before invoking anything here.
 */

const MIN_REASON_LENGTH = 10

export interface TenantListRow {
  tenant: Tenant
  plan: Pick<SaasPlan, 'id' | 'code' | 'nameEn'> | null
  subscriptionStatus: TenantSubscription['status'] | null
  userCount: number
  carrierCount: number
  lastActivityAt: Date | null
}

export async function listTenantsForPlatform(): Promise<TenantListRow[]> {
  const tenantRows = await unsafeDb.select().from(tenants).orderBy(desc(tenants.createdAt))
  if (tenantRows.length === 0) return []

  const [subscriptionRows, userCounts, carrierCounts, activityRows] = await Promise.all([
    unsafeDb
      .select({
        tenantId: tenantSubscriptions.tenantId,
        status: tenantSubscriptions.status,
        planId: tenantSubscriptions.planId,
        planCode: saasPlans.code,
        planNameEn: saasPlans.nameEn,
        createdAt: tenantSubscriptions.createdAt,
      })
      .from(tenantSubscriptions)
      .innerJoin(saasPlans, eq(saasPlans.id, tenantSubscriptions.planId))
      .orderBy(desc(tenantSubscriptions.createdAt)),
    unsafeDb
      .select({ tenantId: userTenantMemberships.tenantId, value: count() })
      .from(userTenantMemberships)
      .where(and(eq(userTenantMemberships.status, 'active'), isNull(userTenantMemberships.deletedAt)))
      .groupBy(userTenantMemberships.tenantId),
    unsafeDb
      .select({ tenantId: carriers.tenantId, value: count() })
      .from(carriers)
      .where(isNull(carriers.deletedAt))
      .groupBy(carriers.tenantId),
    unsafeDb
      .select({ tenantId: loads.tenantId, lastActivityAt: max(loads.updatedAt) })
      .from(loads)
      .groupBy(loads.tenantId),
  ])

  const latestSubscriptionByTenant = new Map<string, (typeof subscriptionRows)[number]>()
  for (const row of subscriptionRows) {
    if (!latestSubscriptionByTenant.has(row.tenantId)) latestSubscriptionByTenant.set(row.tenantId, row)
  }
  const userCountByTenant = new Map(userCounts.map((r) => [r.tenantId, r.value]))
  const carrierCountByTenant = new Map(carrierCounts.map((r) => [r.tenantId, r.value]))
  const activityByTenant = new Map(activityRows.map((r) => [r.tenantId, r.lastActivityAt]))

  return tenantRows.map((tenant) => {
    const subscription = latestSubscriptionByTenant.get(tenant.id)
    return {
      tenant,
      plan: subscription ? { id: subscription.planId, code: subscription.planCode, nameEn: subscription.planNameEn } : null,
      subscriptionStatus: subscription?.status ?? null,
      userCount: userCountByTenant.get(tenant.id) ?? 0,
      carrierCount: carrierCountByTenant.get(tenant.id) ?? 0,
      lastActivityAt: activityByTenant.get(tenant.id) ?? null,
    }
  })
}

export async function getTenantForPlatform(tenantId: string): Promise<Tenant | null> {
  const [row] = await unsafeDb.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  return row ?? null
}

export async function suspendTenant(
  actor: Actor,
  request: AuditRequestContext,
  tenantId: string,
  reason: string,
): Promise<Tenant> {
  if (reason.trim().length < MIN_REASON_LENGTH) {
    throw validationFailed('validation.minLength', { min: MIN_REASON_LENGTH })
  }
  const existing = await getTenantForPlatform(tenantId)
  if (!existing) throw notFound('errors.notFound')
  if (existing.status === 'suspended') throw conflict('platform.errors.alreadySuspended')

  const [updated] = await unsafeDb
    .update(tenants)
    .set({ status: 'suspended', suspendedAt: new Date(), suspensionReason: reason })
    .where(eq(tenants.id, tenantId))
    .returning()

  await recordAudit(actor, request, {
    action: 'tenant.suspended',
    entityType: 'tenant',
    entityId: tenantId,
    entityLabel: existing.displayName,
    reason,
    tenantId,
  })

  return updated!
}

export async function reactivateTenant(
  actor: Actor,
  request: AuditRequestContext,
  tenantId: string,
  reason: string,
): Promise<Tenant> {
  if (reason.trim().length < MIN_REASON_LENGTH) {
    throw validationFailed('validation.minLength', { min: MIN_REASON_LENGTH })
  }
  const existing = await getTenantForPlatform(tenantId)
  if (!existing) throw notFound('errors.notFound')
  if (existing.status !== 'suspended') throw conflict('platform.errors.notSuspended')

  const [updated] = await unsafeDb
    .update(tenants)
    .set({ status: 'active', suspendedAt: null, suspensionReason: null })
    .where(eq(tenants.id, tenantId))
    .returning()

  await recordAudit(actor, request, {
    action: 'tenant.reactivated',
    entityType: 'tenant',
    entityId: tenantId,
    entityLabel: existing.displayName,
    reason,
    tenantId,
  })

  return updated!
}
