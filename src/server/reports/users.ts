import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { users, userTenantMemberships } from '@/db/schema'
import { fullName } from '@/lib/utils'

/**
 * `users` has no `tenant_id` column; the tenant boundary is proven through an
 * inner join to `user_tenant_memberships`, matching the pattern already
 * established in `app/carriers/_lib/queries.ts::primaryDispatchersFor`.
 */
export async function resolveUserNames(db: TenantDb, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)].filter(Boolean)
  if (ids.length === 0) return new Map()

  const rows = await db.builderRequiringExplicitTenantPredicate
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .innerJoin(
      userTenantMemberships,
      and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, db.tenantId)),
    )
    .where(inArray(users.id, ids))

  return new Map(rows.map((u) => [u.id, fullName(u)]))
}
