import 'server-only'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { leads, type Lead } from '@/db/schema'

/**
 * Read models for the lead-intake queue, including `source: 'carrier_signup'`
 * submissions from the public marketing site.
 *
 * The public marketing site (`src/server/marketing/**`) has no tenant
 * context — every lead it inserts carries `tenantId: null` (see that
 * module's own comment on `submitCarrierSignupAction`). `listTenantLeads`
 * covers the ordinary, already-tenant-owned case (a lead a tenant captured
 * itself, or one already claimed by converting/assigning it); until the
 * platform layer decides how an unclaimed public submission is routed to a
 * specific tenant, `listUnclaimedCarrierSignupLeads` is the honest interim:
 * every tenant Admin sees the same shared, tenantless intake pool and claims
 * a row by converting it (see `service.ts`'s `convertLeadToCarrier`, which
 * claims with a race-safe `WHERE tenant_id IS NULL` update). This is called
 * out as a gap in the final report, not silently patched over.
 */

export interface CarrierSignupPayload {
  legalName: string
  dba: string | null
  contactFirstName: string
  contactLastName: string
  email: string
  phone: string
  dotNumber: string
  mcNumber: string | null
  ein: string | null
  physicalAddress: { line1: string; line2?: string | null; city: string; state: string; postalCode: string }
  mailingAddress?: { line1: string; line2?: string | null; city: string; state: string; postalCode: string }
  website: string | null
  preferredLocale: 'en' | 'es'
  factoringApplies: boolean
}

/** `leads.message` carries the carrier-signup JSON payload as text (see `marketing/actions.ts`). Never throws on malformed JSON — returns `null` instead. */
export function parseCarrierSignupPayload(lead: Lead): CarrierSignupPayload | null {
  if (lead.source !== 'carrier_signup' || !lead.message) return null
  try {
    return JSON.parse(lead.message) as CarrierSignupPayload
  } catch {
    return null
  }
}

export interface ListLeadsOptions {
  status?: string
  source?: string
}

/** Leads already owned by this tenant (captured directly, or previously claimed/converted). */
export async function listTenantLeads(db: TenantDb, options: ListLeadsOptions = {}): Promise<Lead[]> {
  const clauses = [eq(leads.tenantId, db.tenantId)]
  if (options.status) clauses.push(eq(leads.status, options.status))
  if (options.source) clauses.push(eq(leads.source, options.source))
  return db.findMany(leads, { where: and(...clauses), orderBy: desc(leads.createdAt) })
}

/**
 * Unclaimed `carrier_signup` leads with no tenant yet — the shared intake
 * pool described above. Uses the explicit-predicate escape hatch because
 * `tenantId IS NULL` is, by definition, outside any single `TenantDb`'s
 * scope.
 */
export async function listUnclaimedCarrierSignupLeads(db: TenantDb): Promise<Lead[]> {
  return db.builderRequiringExplicitTenantPredicate
    .select()
    .from(leads)
    .where(and(isNull(leads.tenantId), eq(leads.source, 'carrier_signup'), isNull(leads.deletedAt))!)
    .orderBy(desc(leads.createdAt)) as unknown as Promise<Lead[]>
}

/** A lead by id, whether already claimed by this tenant or still sitting unclaimed. */
export async function getLeadForTenant(db: TenantDb, leadId: string): Promise<Lead | null> {
  const owned = await db.findById(leads, leadId)
  if (owned) return owned
  const unclaimed = await db.builderRequiringExplicitTenantPredicate
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), isNull(leads.tenantId), isNull(leads.deletedAt))!)
    .limit(1)
  return (unclaimed[0] as Lead | undefined) ?? null
}
