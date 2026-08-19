import 'server-only'
import { eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { saasPlans, users } from '@/db/schema'
import type { Actor } from '@/lib/permissions'
import { createPlan } from '@/server/platform/plans'
import { createSeedUser, SEED_REQUEST_CONTEXT, logStep } from './helpers'

export interface SeedPlans {
  starterCode: string
  growthCode: string
  enterpriseCode: string
}

/**
 * SaaS plans (`saas_plans`) — created through the real `createPlan()`
 * service (Platform console's `platform:plan:manage`), not a direct insert.
 * `createPlan` needs a real `Actor` for its audit write (`actorUserId` is a
 * uuid column, so a placeholder id would fail that insert) — the caller
 * passes the Platform Super Admin's own actor, created just before this by
 * `seedPlatformSuperAdmin()`.
 */
export async function seedPlans(actor: Actor): Promise<SeedPlans> {
  logStep('▸ platform: SaaS plans')

  const existing = await unsafeDb.select({ code: saasPlans.code }).from(saasPlans)
  const existingCodes = new Set(existing.map((p) => p.code))

  const defs: Array<Parameters<typeof createPlan>[2]> = [
    {
      code: 'starter',
      nameEn: 'Starter',
      nameEs: 'Inicial',
      descriptionEn: 'For a new dispatch operation getting its first carriers onboarded.',
      descriptionEs: 'Para una operación de despacho nueva que incorpora a sus primeros transportistas.',
      monthlyPriceCents: 14_900,
      trialDays: 14,
      maxUsers: 5,
      maxCarriers: 15,
      maxLoadsPerMonth: 100,
      features: ['carriers', 'loads', 'documents', 'basic_tracking'],
      isPublic: true,
      sortOrder: 1,
    },
    {
      code: 'growth',
      nameEn: 'Growth',
      nameEs: 'Crecimiento',
      descriptionEn: 'For an established dispatch company running oversize/overweight freight at volume.',
      descriptionEs: 'Para una empresa de despacho establecida que maneja carga sobredimensionada y con exceso de peso en volumen.',
      monthlyPriceCents: 39_900,
      trialDays: 0,
      maxUsers: 25,
      maxCarriers: 75,
      maxLoadsPerMonth: 750,
      features: ['carriers', 'loads', 'documents', 'live_tracking', 'oversize_permits', 'factoring', 'settlements'],
      isPublic: true,
      sortOrder: 2,
    },
    {
      code: 'enterprise',
      nameEn: 'Enterprise',
      nameEs: 'Empresarial',
      descriptionEn: 'Unlimited carriers and loads, dedicated support, and custom retention policies.',
      descriptionEs: 'Transportistas y cargas ilimitados, soporte dedicado y políticas de retención personalizadas.',
      monthlyPriceCents: 99_900,
      trialDays: 0,
      maxUsers: null,
      maxCarriers: null,
      maxLoadsPerMonth: null,
      features: ['carriers', 'loads', 'documents', 'live_tracking', 'oversize_permits', 'factoring', 'settlements', 'api_access', 'sso'],
      isPublic: true,
      sortOrder: 3,
    },
  ]

  for (const def of defs) {
    if (!existingCodes.has(def.code)) {
      await createPlan(actor, SEED_REQUEST_CONTEXT, def)
    }
  }

  return { starterCode: 'starter', growthCode: 'growth', enterpriseCode: 'enterprise' }
}

export interface SeedPlatformAdmin {
  userId: string
  email: string
  password: string
}

/** The one Platform Super Admin — global (`tenantId: null`) access to the Platform console. */
export async function seedPlatformSuperAdmin(password: string): Promise<SeedPlatformAdmin> {
  logStep('▸ platform: Super Admin')

  const email = 'admin.platform@example.com'
  const existing = await unsafeDb.select({ id: users.id }).from(users).where(eq(users.emailNormalized, email)).limit(1)
  if (existing[0]) {
    return { userId: existing[0].id, email, password }
  }

  const created = await createSeedUser(null, {
    firstName: 'Priya',
    lastName: 'Okafor',
    email,
    role: 'platform_super_admin',
    locale: 'en',
    password,
  })

  await unsafeDb.update(users).set({ isPlatformSuperAdmin: true }).where(eq(users.id, created.userId))

  return created
}
