import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { users, userTenantMemberships } from '@/db/schema'
import { fullName } from '@/lib/utils'

/** Tenant staff who can be assigned a lead (Admin/Accounting/Dispatcher — not Carrier/Driver). */
export async function listAssignableUsers(db: TenantDb): Promise<{ userId: string; name: string }[]> {
  const rows = await db.builderRequiringExplicitTenantPredicate
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .innerJoin(
      userTenantMemberships,
      and(
        eq(userTenantMemberships.userId, users.id),
        eq(userTenantMemberships.tenantId, db.tenantId),
        inArray(userTenantMemberships.role, ['admin', 'accounting', 'dispatcher']),
        eq(userTenantMemberships.status, 'active'),
      ),
    )
  return rows.map((u) => ({ userId: u.id, name: fullName(u) }))
}
