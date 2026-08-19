import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import {
  consentRecords,
  leads,
  notifications,
  quoteRequests,
  userTenantMemberships,
  users,
  type NewUser,
} from '@/db/schema'
import type { Locale } from '@/i18n/config'

/**
 * Cross-tenant data access for the public marketing site.
 *
 * The marketing site (`src/app/[locale]/(marketing)/**`) runs above any single
 * tenant: a visitor filling out the contact form, a quote request or the
 * carrier-signup form has not been resolved to a tenant yet, so none of this
 * can go through `tenantDb()`. This mirrors the existing exception already
 * granted to `src/lib/auth/session.ts` (identity/session resolution is also
 * global) — see `eslint.config.mjs`'s `no-restricted-imports` override for
 * `src/server/platform/**`, which exists for exactly this kind of "Super
 * Admin / platform tooling" work. This file is intentionally the *only* place
 * under `src/server/marketing/**` that reaches for `unsafeDb`.
 */

export interface InsertLeadInput {
  tenantId: string | null
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  companyName?: string | null
  dotNumber?: string | null
  mcNumber?: string | null
  message?: string | null
  locale: Locale
  source: string
  sourcePath?: string | null
  ipAddress: string | null
  userAgent: string | null
}

export async function insertLead(input: InsertLeadInput): Promise<{ id: string }> {
  const [row] = await unsafeDb
    .insert(leads)
    .values({
      tenantId: input.tenantId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone ?? null,
      companyName: input.companyName ?? null,
      dotNumber: input.dotNumber ?? null,
      mcNumber: input.mcNumber ?? null,
      message: input.message ?? null,
      locale: input.locale,
      source: input.source,
      sourcePath: input.sourcePath ?? null,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    })
    .returning({ id: leads.id })
  return row
}

export interface InsertQuoteRequestInput {
  tenantId: string | null
  leadId: string | null
  contactName: string
  email: string
  phone?: string | null
  companyName?: string | null
  commodity?: string | null
  weightPounds?: number | null
  lengthInches?: number | null
  widthInches?: number | null
  heightInches?: number | null
  originCity?: string | null
  originState?: string | null
  destinationCity?: string | null
  destinationState?: string | null
  readyDate?: Date | null
  equipmentPreference?: string | null
  isOversizeSuspected: boolean
  notes?: string | null
  locale: Locale
  ipAddress: string | null
  userAgent: string | null
}

export async function insertQuoteRequest(input: InsertQuoteRequestInput): Promise<{ id: string }> {
  const [row] = await unsafeDb
    .insert(quoteRequests)
    .values({
      tenantId: input.tenantId,
      leadId: input.leadId,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone ?? null,
      companyName: input.companyName ?? null,
      commodity: input.commodity ?? null,
      weightPounds: input.weightPounds ?? null,
      lengthInches: input.lengthInches ?? null,
      widthInches: input.widthInches ?? null,
      heightInches: input.heightInches ?? null,
      originCity: input.originCity ?? null,
      originState: input.originState ?? null,
      destinationCity: input.destinationCity ?? null,
      destinationState: input.destinationState ?? null,
      readyDate: input.readyDate ?? null,
      equipmentPreference: input.equipmentPreference ?? null,
      isOversizeSuspected: input.isOversizeSuspected,
      notes: input.notes ?? null,
      locale: input.locale,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    })
    .returning({ id: quoteRequests.id })
  return row
}

export interface InsertConsentInput {
  tenantId: string | null
  subjectEmail: string
  consentType: (typeof consentRecords.consentType.enumValues)[number]
  policyVersion: string
  locale: Locale
  ipAddress: string | null
  userAgent: string | null
}

export async function insertConsentRecords(inputs: InsertConsentInput[]): Promise<void> {
  if (inputs.length === 0) return
  await unsafeDb.insert(consentRecords).values(
    inputs.map((input) => ({
      tenantId: input.tenantId,
      subjectEmail: input.subjectEmail,
      consentType: input.consentType,
      policyVersion: input.policyVersion,
      granted: true,
      locale: input.locale,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    })),
  )
}

/**
 * Recipients for a lead/quote/carrier-signup notification.
 *
 * When a tenant context exists (a future white-label marketing surface for a
 * single dispatch company), the relevant tenant's Admins are notified. There
 * is no tenant context on the platform SaaS marketing site today, so the
 * fallback is the set of platform Super Admins — the closest equivalent to
 * "whoever should hear about a new prospect" when no tenant owns the lead yet.
 */
export interface NotifyRecipient {
  userId: string
  email: string
  locale: Locale
}

export async function findTenantAdminRecipients(tenantId: string): Promise<NotifyRecipient[]> {
  const rows = await unsafeDb
    .select({ userId: users.id, email: users.email, locale: users.locale })
    .from(userTenantMemberships)
    .innerJoin(users, eq(users.id, userTenantMemberships.userId))
    .where(
      and(
        eq(userTenantMemberships.tenantId, tenantId),
        eq(userTenantMemberships.role, 'admin'),
        isNull(userTenantMemberships.deletedAt),
        eq(users.status, 'active'),
      ),
    )
  return rows.map((r) => ({ userId: r.userId, email: r.email, locale: (r.locale as Locale) ?? 'en' }))
}

export async function findPlatformSuperAdminRecipients(): Promise<NotifyRecipient[]> {
  const rows = await unsafeDb
    .select({ userId: users.id, email: users.email, locale: users.locale })
    .from(users)
    .where(and(eq(users.isPlatformSuperAdmin, true), eq(users.status, 'active')))
  return rows.map((r) => ({ userId: r.userId, email: r.email, locale: (r.locale as Locale) ?? 'en' }))
}

export interface InsertInAppNotificationInput {
  tenantId: string
  userId: string
  eventKey: string
  locale: Locale
  title: string
  body: string
  actionUrl?: string | null
  subjectType: string
  subjectId: string
  dedupeKey: string
}

/** In-app notification for a tenant-scoped recipient. See `notify.ts` for when this applies. */
export async function insertInAppNotification(input: InsertInAppNotificationInput): Promise<void> {
  await unsafeDb
    .insert(notifications)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      eventKey: input.eventKey,
      channel: 'in_app',
      status: 'queued',
      locale: input.locale,
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl ?? null,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      dedupeKey: input.dedupeKey,
    })
    .onConflictDoNothing()
}

export type { NewUser }
