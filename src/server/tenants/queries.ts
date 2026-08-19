import 'server-only'
import { asc, eq, isNull } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { saasPlans, tenantSubscriptions, tenants } from '@/db/schema'

/**
 * Read-side queries for the pricing/signup UI and the tenant billing screen.
 */

export interface PlanSummary {
  id: string
  code: string
  nameEn: string
  nameEs: string
  descriptionEn: string | null
  descriptionEs: string | null
  monthlyPriceCents: number
  trialDays: number
  maxUsers: number | null
  maxCarriers: number | null
  maxLoadsPerMonth: number | null
  features: string[]
}

const DEFAULT_PLAN_SEED: Array<Omit<typeof saasPlans.$inferInsert, 'id'>> = [
  {
    code: 'starter',
    nameEn: 'Starter',
    nameEs: 'Inicial',
    descriptionEn: 'For a single dispatch team getting off the ground.',
    descriptionEs: 'Para un equipo de despacho que está comenzando.',
    monthlyPriceCents: 14_900,
    trialDays: 14,
    maxUsers: 5,
    maxCarriers: 25,
    maxLoadsPerMonth: 150,
    features: ['carrier_onboarding', 'e_signature', 'basic_reporting'],
    isPublic: true,
    sortOrder: 1,
  },
  {
    code: 'growth',
    nameEn: 'Growth',
    nameEs: 'Crecimiento',
    descriptionEn: 'For a dispatch company running multiple carriers and dispatchers.',
    descriptionEs: 'Para una empresa de despacho con múltiples transportistas y despachadores.',
    monthlyPriceCents: 34_900,
    trialDays: 14,
    maxUsers: 20,
    maxCarriers: 150,
    maxLoadsPerMonth: 1000,
    features: ['carrier_onboarding', 'e_signature', 'oversize_routing', 'tracking', 'advanced_reporting'],
    isPublic: true,
    sortOrder: 2,
  },
  {
    code: 'enterprise',
    nameEn: 'Enterprise',
    nameEs: 'Empresarial',
    descriptionEn: 'For a heavy-haul operation with dedicated support and unlimited scale.',
    descriptionEs: 'Para una operación de carga pesada con soporte dedicado y escala ilimitada.',
    monthlyPriceCents: 79_900,
    trialDays: 14,
    maxUsers: null,
    maxCarriers: null,
    maxLoadsPerMonth: null,
    features: [
      'carrier_onboarding',
      'e_signature',
      'oversize_routing',
      'tracking',
      'advanced_reporting',
      'factoring',
      'priority_support',
    ],
    isPublic: true,
    sortOrder: 3,
  },
]

/**
 * Lazily seeds the three default plans the first time any request needs
 * them. There is no standalone seed script in this codebase yet for
 * `saas_plans`, and a public signup page cannot function without at least
 * one plan to offer — this keeps the flow self-healing in every environment.
 */
export async function ensureDefaultPlans(): Promise<void> {
  const count = await unsafeDb.select({ id: saasPlans.id }).from(saasPlans).limit(1)
  if (count.length > 0) return
  await unsafeDb.insert(saasPlans).values(DEFAULT_PLAN_SEED).onConflictDoNothing()
}

function toSummary(row: typeof saasPlans.$inferSelect): PlanSummary {
  return {
    id: row.id,
    code: row.code,
    nameEn: row.nameEn,
    nameEs: row.nameEs,
    descriptionEn: row.descriptionEn,
    descriptionEs: row.descriptionEs,
    monthlyPriceCents: row.monthlyPriceCents,
    trialDays: row.trialDays,
    maxUsers: row.maxUsers,
    maxCarriers: row.maxCarriers,
    maxLoadsPerMonth: row.maxLoadsPerMonth,
    features: row.features,
  }
}

export async function listPublicPlans(): Promise<PlanSummary[]> {
  await ensureDefaultPlans()
  const rows = await unsafeDb
    .select()
    .from(saasPlans)
    .where(eq(saasPlans.isPublic, true))
    .orderBy(asc(saasPlans.sortOrder))
  return rows.map(toSummary)
}

export async function getPlanByCode(code: string): Promise<PlanSummary | null> {
  await ensureDefaultPlans()
  const row = await unsafeDb
    .select()
    .from(saasPlans)
    .where(eq(saasPlans.code, code))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return row ? toSummary(row) : null
}

export interface CurrentSubscriptionSummary {
  planCode: string
  planNameEn: string
  planNameEs: string
  status: string
  currentPeriodEnd: Date | null
  trialEndsAt: Date | null
  cancelAtPeriodEnd: boolean
  tenantStatus: string
}

/** Current subscription for the tenant billing screen. */
export async function getCurrentSubscription(tenantId: string): Promise<CurrentSubscriptionSummary | null> {
  const row = await unsafeDb
    .select({
      status: tenantSubscriptions.status,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      trialEndsAt: tenantSubscriptions.trialEndsAt,
      cancelAtPeriodEnd: tenantSubscriptions.cancelAtPeriodEnd,
      planCode: saasPlans.code,
      planNameEn: saasPlans.nameEn,
      planNameEs: saasPlans.nameEs,
      tenantStatus: tenants.status,
    })
    .from(tenantSubscriptions)
    .innerJoin(saasPlans, eq(saasPlans.id, tenantSubscriptions.planId))
    .innerJoin(tenants, eq(tenants.id, tenantSubscriptions.tenantId))
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .orderBy(asc(tenantSubscriptions.createdAt))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return row
}

export interface TenantSwitcherOption {
  id: string
  name: string
}

/**
 * Every tenant, for the Platform Super Admin's switcher.
 *
 * Deliberately platform-scoped and deliberately minimal: it returns names and
 * ids only. Reading a tenant's operational data still requires opening an
 * explicit support-access session, which is audited — switching the chrome is
 * not the same as being granted the data.
 */
export async function listTenantsForSwitcher(): Promise<TenantSwitcherOption[]> {
  return unsafeDb
    .select({ id: tenants.id, name: tenants.displayName })
    .from(tenants)
    .where(isNull(tenants.deletedAt))
    .orderBy(tenants.displayName)
}
