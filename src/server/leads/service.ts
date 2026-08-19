import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { leads, type Lead } from '@/db/schema'
import { AppError, notFound } from '@/lib/errors'
import { createCarrier, type CreateCarrierInput, type CreateCarrierResult } from '@/server/carriers'
import { getLeadForTenant, parseCarrierSignupPayload } from './queries'

/**
 * Mutations for the lead-intake queue.
 *
 * `convertLeadToCarrier` is the one place this module writes to a lead it
 * does not yet own (`tenantId IS NULL`) — the `WHERE tenant_id IS NULL`
 * clause on that claim makes two tenants racing to convert the same
 * unclaimed lead resolve to exactly one winner, the same way
 * `carriers.dotNumber`'s uniqueness check protects against a duplicate
 * carrier, just enforced in application code instead of a unique index
 * (there is no per-tenant uniqueness constraint to lean on here).
 */

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'disqualified'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export async function updateLeadStatus(db: TenantDb, leadId: string, status: LeadStatus): Promise<Lead> {
  const lead = await getLeadForTenant(db, leadId)
  if (!lead) throw notFound('errors.notFound', { entity: 'lead' })

  if (lead.tenantId === db.tenantId) {
    const updated = await db.update(leads, leadId, { status })
    if (!updated) throw notFound('errors.notFound', { entity: 'lead' })
    return updated
  }

  // Still unclaimed: updating its status (e.g. "contacted") without
  // converting it yet claims it for this tenant, the same as conversion
  // does, so it drops out of every other tenant's shared queue.
  return claimUnclaimedLead(db, leadId, { status })
}

export async function assignLead(db: TenantDb, leadId: string, assignedToUserId: string | null): Promise<Lead> {
  const lead = await getLeadForTenant(db, leadId)
  if (!lead) throw notFound('errors.notFound', { entity: 'lead' })

  if (lead.tenantId === db.tenantId) {
    const updated = await db.update(leads, leadId, { assignedToUserId })
    if (!updated) throw notFound('errors.notFound', { entity: 'lead' })
    return updated
  }

  return claimUnclaimedLead(db, leadId, { assignedToUserId })
}

async function claimUnclaimedLead(db: TenantDb, leadId: string, patch: Partial<Lead>): Promise<Lead> {
  const rows = await db.builderRequiringExplicitTenantPredicate
    .update(leads)
    .set({ ...patch, tenantId: db.tenantId })
    .where(and(eq(leads.id, leadId), isNull(leads.tenantId))!)
    .returning()
  const claimed = rows[0] as Lead | undefined
  if (!claimed) {
    throw new AppError('conflict', 'errors.conflict', { params: { entity: 'lead' } })
  }
  return claimed
}

export interface ConvertLeadToCarrierResult {
  lead: Lead
  carrier: CreateCarrierResult['carrier']
  onboarding: CreateCarrierResult['onboarding']
}

/**
 * Pre-fills `createCarrier`'s input from a `carrier_signup` lead's parsed
 * payload, letting the caller override/complete anything (a dispatch fee,
 * a corrected address) before submission, then claims the lead for this
 * tenant and marks it `converted` — same transaction as the carrier create,
 * so a lead is never left half-converted.
 */
export async function convertLeadToCarrier(
  db: TenantDb,
  actor: { userId: string },
  leadId: string,
  overrides: Partial<CreateCarrierInput>,
): Promise<ConvertLeadToCarrierResult> {
  const lead = await getLeadForTenant(db, leadId)
  if (!lead) throw notFound('errors.notFound', { entity: 'lead' })
  if (lead.status === 'converted') {
    throw new AppError('conflict', 'errors.conflict', { params: { entity: 'lead' } })
  }

  const payload = parseCarrierSignupPayload(lead)

  const input: CreateCarrierInput = {
    legalName: payload?.legalName ?? lead.companyName ?? '',
    dba: payload?.dba ?? null,
    dotNumber: payload?.dotNumber ?? lead.dotNumber ?? '',
    mcNumber: payload?.mcNumber ?? lead.mcNumber ?? null,
    ein: payload?.ein ?? '',
    contactFirstName: payload?.contactFirstName ?? lead.firstName,
    contactLastName: payload?.contactLastName ?? lead.lastName,
    email: payload?.email ?? lead.email,
    phone: payload?.phone ?? lead.phone ?? '',
    website: payload?.website ?? null,
    preferredLocale: payload?.preferredLocale ?? lead.locale,
    physicalLine1: payload?.physicalAddress.line1 ?? null,
    physicalLine2: payload?.physicalAddress.line2 ?? null,
    physicalCity: payload?.physicalAddress.city ?? null,
    physicalState: payload?.physicalAddress.state ?? null,
    physicalPostalCode: payload?.physicalAddress.postalCode ?? null,
    mailingSameAsPhysical: !payload?.mailingAddress,
    mailingLine1: payload?.mailingAddress?.line1 ?? null,
    mailingLine2: payload?.mailingAddress?.line2 ?? null,
    mailingCity: payload?.mailingAddress?.city ?? null,
    mailingState: payload?.mailingAddress?.state ?? null,
    mailingPostalCode: payload?.mailingAddress?.postalCode ?? null,
    usesFactoring: payload?.factoringApplies ?? false,
    ...overrides,
  }

  return db.transaction(async (tx) => {
    const { carrier, onboarding } = await createCarrier(tx, actor, input)

    let claimedLead: Lead
    if (lead.tenantId === tx.tenantId) {
      const updated = await tx.update(leads, leadId, { status: 'converted' })
      if (!updated) throw notFound('errors.notFound', { entity: 'lead' })
      claimedLead = updated
    } else {
      claimedLead = await claimUnclaimedLead(tx, leadId, { status: 'converted' })
    }

    return { lead: claimedLead, carrier, onboarding }
  })
}
