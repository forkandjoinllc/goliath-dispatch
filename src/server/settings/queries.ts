import 'server-only'
import { tenantBranding, tenantSettings, tenants, type Tenant, type TenantBranding, type TenantSettings } from '@/db/schema'
import type { TenantDb } from '@/db/tenant-db'
import { eq } from 'drizzle-orm'

/**
 * Tenant settings read model. `tenant_branding` and `tenant_settings` are
 * both 1:1 with the tenant and may not yet have a row for a freshly
 * provisioned tenant (the branding/settings rows are created by
 * `src/server/tenants/provisioning.ts`, owned by another agent) — callers
 * get the schema defaults back rather than `null` so every settings screen
 * always has something to render.
 */

export interface TenantSettingsBundle {
  tenant: Tenant
  settings: TenantSettings
  branding: TenantBranding
}

export async function getSettingsBundle(db: TenantDb): Promise<TenantSettingsBundle> {
  const tenant = await db.builderRequiringExplicitTenantPredicate
    .select()
    .from(tenants)
    .where(eq(tenants.id, db.tenantId))
    .limit(1)
    .then((rows) => rows[0])
  if (!tenant) throw new Error(`Tenant ${db.tenantId} not found`)

  const [settings, branding] = await Promise.all([
    db.findFirst(tenantSettings, { where: eq(tenantSettings.tenantId, db.tenantId) }),
    db.findFirst(tenantBranding, { where: eq(tenantBranding.tenantId, db.tenantId) }),
  ])

  return {
    tenant,
    settings: settings ?? defaultSettings(db.tenantId),
    branding: branding ?? defaultBranding(db.tenantId),
  }
}

function defaultSettings(tenantId: string): TenantSettings {
  const now = new Date()
  return {
    id: '',
    tenantId,
    contactPhone: null,
    contactEmail: null,
    supportEmail: null,
    addressLine1: null,
    addressLine2: null,
    addressCity: null,
    addressState: null,
    addressPostalCode: null,
    addressCountry: 'US',
    businessHours: null,
    socialLinks: null,
    documentExpirationWarningDays: 30,
    fmcsaReverificationDays: 7,
    allowDispatcherResourceAssignment: false,
    requireOversizeAdminValidation: true,
    loadNumberPrefix: 'GD',
    loadNumberNextSequence: 1000,
    invoiceNumberPrefix: 'INV',
    invoiceNumberNextSequence: 1000,
    defaultPaymentTermsDays: 30,
    defaultCarrierDispatchFeeBps: 1000,
    defaultDispatcherCommissionBps: 2500,
    dispatcherCommissionBasis: 'dispatch_fee_amount',
    operationalActiveMonths: 24,
    operationalPurgeYearsAfterArchive: 5,
    financialRetentionYears: 7,
    publicTrackingEnabled: true,
    publicTrackingTokenTtlHours: 72,
    signatureConsentCopy: null,
    createdAt: now,
    updatedAt: now,
  }
}

function defaultBranding(tenantId: string): TenantBranding {
  const now = new Date()
  return {
    id: '',
    tenantId,
    logoStorageKey: null,
    logoDarkStorageKey: null,
    faviconStorageKey: null,
    primaryColor: '#062B5C',
    accentColor: '#FF5A00',
    neutralColor: '#9B9B9B',
    surfaceColor: '#FFFFFF',
    inkColor: '#111827',
    headingFont: 'Roboto Condensed',
    bodyFont: 'Inter',
    emailHeaderHtml: null,
    emailFooterHtml: null,
    createdAt: now,
    updatedAt: now,
  }
}
