import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { userTenantMemberships, users } from '@/db/schema'
import type { Role } from '@/lib/permissions'

/** Internal-staff roles managed from the "Users" screen — not carrier/driver portal accounts. */
export const INTERNAL_ROLES: Role[] = ['admin', 'accounting', 'dispatcher']

export interface TenantUserRow {
  membershipId: string
  userId: string
  firstName: string
  lastName: string
  email: string
  role: Role
  status: string
  invitedAt: Date | null
  acceptedAt: Date | null
}

/**
 * Lists every internal-staff membership in the tenant. `users` has no
 * `tenant_id` column of its own (identity is global) — the tenant predicate
 * is proven by joining through `userTenantMemberships`, the same pattern
 * `carriers/queries.ts` uses for dispatcher name lookups.
 */
export async function listTenantUsers(db: TenantDb): Promise<TenantUserRow[]> {
  const rows = await db.builderRequiringExplicitTenantPredicate
    .select({
      membershipId: userTenantMemberships.id,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: userTenantMemberships.role,
      status: userTenantMemberships.status,
      invitedAt: userTenantMemberships.invitedAt,
      acceptedAt: userTenantMemberships.acceptedAt,
    })
    .from(userTenantMemberships)
    .innerJoin(users, eq(users.id, userTenantMemberships.userId))
    .where(
      and(
        eq(userTenantMemberships.tenantId, db.tenantId),
        inArray(userTenantMemberships.role, INTERNAL_ROLES),
      ),
    )
    .orderBy(desc(userTenantMemberships.createdAt))

  return rows
}
