import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { carriers, loads, users, userTenantMemberships } from '@/db/schema'
import { fullName } from '@/lib/utils'

export interface MessageableUser {
  userId: string
  name: string
  role: string
}

/** Every active tenant member, for the "add participant" / "new conversation" pickers. */
export async function listMessageableUsers(db: TenantDb): Promise<MessageableUser[]> {
  const rows = await db.builderRequiringExplicitTenantPredicate
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: userTenantMemberships.role })
    .from(users)
    .innerJoin(
      userTenantMemberships,
      and(
        eq(userTenantMemberships.userId, users.id),
        eq(userTenantMemberships.tenantId, db.tenantId),
        eq(userTenantMemberships.status, 'active'),
      ),
    )
  return rows.map((u) => ({ userId: u.id, name: fullName(u), role: u.role }))
}

/** Load numbers for a conversation-list/thread-header's "Load {loadNumber}" context. */
export async function loadNumbersFor(db: TenantDb, loadIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(loadIds)].filter(Boolean)
  if (ids.length === 0) return new Map()
  const rows = await db.findMany(loads, { where: inArray(loads.id, ids) })
  return new Map(rows.map((l) => [l.id, l.loadNumber]))
}

/** Carrier names for a conversation-list/thread-header's "Carrier: {name}" context. */
export async function carrierNamesFor(db: TenantDb, carrierIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(carrierIds)].filter(Boolean)
  if (ids.length === 0) return new Map()
  const rows = await db.findMany(carriers, { where: inArray(carriers.id, ids) })
  return new Map(rows.map((c) => [c.id, c.legalName]))
}
