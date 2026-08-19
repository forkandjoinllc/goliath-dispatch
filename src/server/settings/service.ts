import 'server-only'
import { eq } from 'drizzle-orm'
import {
  tenantBranding,
  tenants,
  tenantSettings,
  type Tenant,
  type TenantBranding,
  type TenantSettings,
} from '@/db/schema'
import type { TenantDb } from '@/db/tenant-db'
import type { Actor } from '@/lib/permissions'
import { diffRecords, recordAudit, type AuditRequestContext } from '@/lib/audit'
import { validationFailed } from '@/lib/errors'
import { checkContrastAgainstWhite } from './branding'

/**
 * Tenant settings writes.
 *
 * Every function here is called from a server action that has already
 * authorized `tenant:settings:update` — this module does not re-check
 * permissions, only validates values and audits the change. Every write
 * ends in a single `settings.updated` audit event carrying a before/after
 * diff (`diffRecords`), so the "what changed" story is always reconstructible
 * from the audit trail alone.
 */

async function upsertSettings(db: TenantDb, patch: Partial<TenantSettings>): Promise<{ before: TenantSettings | null; after: TenantSettings }> {
  const existing = await db.findFirst(tenantSettings, { where: eq(tenantSettings.tenantId, db.tenantId) })
  if (existing) {
    const updated = await db.update(tenantSettings, existing.id, patch)
    return { before: existing, after: updated! }
  }
  const created = await db.insert(tenantSettings, patch as Omit<TenantSettings, 'tenantId'>)
  return { before: null, after: created }
}

async function upsertBranding(db: TenantDb, patch: Partial<TenantBranding>): Promise<{ before: TenantBranding | null; after: TenantBranding }> {
  const existing = await db.findFirst(tenantBranding, { where: eq(tenantBranding.tenantId, db.tenantId) })
  if (existing) {
    const updated = await db.update(tenantBranding, existing.id, patch)
    return { before: existing, after: updated! }
  }
  const created = await db.insert(tenantBranding, patch as Omit<TenantBranding, 'tenantId'>)
  return { before: null, after: created }
}

async function auditSettingsChange(
  actor: Actor & { tenantId: string },
  request: AuditRequestContext,
  entityType: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Promise<void> {
  const diff = diffRecords(before ?? {}, after)
  if (Object.keys(diff.after).length === 0) return
  await recordAudit(actor, request, {
    action: 'settings.updated',
    entityType,
    entityId: actor.tenantId,
    before: diff.before,
    after: diff.after,
    tenantId: actor.tenantId,
  })
}

/* ── Company identity (lives on `tenants`, not `tenant_settings`) ────────── */

export interface UpdateCompanyIdentityInput {
  legalName?: string
  displayName?: string
  defaultLocale?: 'en' | 'es'
  defaultTimezone?: string
  customDomain?: string | null
}

export async function updateCompanyIdentity(
  db: TenantDb,
  actor: Actor & { tenantId: string },
  request: AuditRequestContext,
  input: UpdateCompanyIdentityInput,
): Promise<Tenant> {
  const [before] = await db.builderRequiringExplicitTenantPredicate
    .select()
    .from(tenants)
    .where(eq(tenants.id, db.tenantId))
    .limit(1)
  if (!before) throw validationFailed('errors.notFound')

  const [after] = await db.builderRequiringExplicitTenantPredicate
    .update(tenants)
    .set(input)
    .where(eq(tenants.id, db.tenantId))
    .returning()

  await auditSettingsChange(actor, request, 'tenant', before, after!)
  return after!
}

/* ── Contact, address, business hours, social links ───────────────────────── */

export interface UpdateContactInput {
  contactPhone?: string | null
  contactEmail?: string | null
  supportEmail?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  addressCity?: string | null
  addressState?: string | null
  addressPostalCode?: string | null
  businessHours?: TenantSettings['businessHours']
  socialLinks?: TenantSettings['socialLinks']
}

export async function updateContact(
  db: TenantDb,
  actor: Actor & { tenantId: string },
  request: AuditRequestContext,
  input: UpdateContactInput,
): Promise<TenantSettings> {
  const { before, after } = await upsertSettings(db, input)
  await auditSettingsChange(actor, request, 'tenant_settings', before, after)
  return after
}

/* ── Operational policy ───────────────────────────────────────────────────── */

export interface UpdateOperationalPolicyInput {
  documentExpirationWarningDays?: number
  fmcsaReverificationDays?: number
  allowDispatcherResourceAssignment?: boolean
  requireOversizeAdminValidation?: boolean
  loadNumberPrefix?: string
  invoiceNumberPrefix?: string
  defaultPaymentTermsDays?: number
  publicTrackingEnabled?: boolean
  publicTrackingTokenTtlHours?: number
}

export async function updateOperationalPolicy(
  db: TenantDb,
  actor: Actor & { tenantId: string },
  request: AuditRequestContext,
  input: UpdateOperationalPolicyInput,
): Promise<TenantSettings> {
  if (input.documentExpirationWarningDays != null && input.documentExpirationWarningDays < 1) {
    throw validationFailed('validation.positive')
  }
  const { before, after } = await upsertSettings(db, input)
  await auditSettingsChange(actor, request, 'tenant_settings', before, after)
  return after
}

/* ── Financial policy ─────────────────────────────────────────────────────── */

export interface UpdateFinancialPolicyInput {
  defaultCarrierDispatchFeeBps?: number
  defaultDispatcherCommissionBps?: number
  dispatcherCommissionBasis?: TenantSettings['dispatcherCommissionBasis']
}

export async function updateFinancialPolicy(
  db: TenantDb,
  actor: Actor & { tenantId: string },
  request: AuditRequestContext,
  input: UpdateFinancialPolicyInput,
): Promise<TenantSettings> {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'number' && (value < 0 || value > 10_000)) {
      throw validationFailed('validation.percentage', { field: key })
    }
  }
  const { before, after } = await upsertSettings(db, input)
  await auditSettingsChange(actor, request, 'tenant_settings', before, after)
  return after
}

/* ── Retention policy ─────────────────────────────────────────────────────── */

export interface UpdateRetentionPolicyInput {
  operationalActiveMonths?: number
  operationalPurgeYearsAfterArchive?: number
  financialRetentionYears?: number
}

const MIN_FINANCIAL_RETENTION_YEARS = 7

export async function updateRetentionPolicy(
  db: TenantDb,
  actor: Actor & { tenantId: string },
  request: AuditRequestContext,
  input: UpdateRetentionPolicyInput,
): Promise<TenantSettings> {
  if (input.financialRetentionYears != null && input.financialRetentionYears < MIN_FINANCIAL_RETENTION_YEARS) {
    throw validationFailed('settings.retention.errors.financialRetentionTooShort', { min: MIN_FINANCIAL_RETENTION_YEARS })
  }
  if (input.operationalActiveMonths != null && input.operationalActiveMonths < 1) {
    throw validationFailed('validation.positive')
  }
  const { before, after } = await upsertSettings(db, input)
  await auditSettingsChange(actor, request, 'tenant_settings', before, after)
  return after
}

/* ── Branding ─────────────────────────────────────────────────────────────── */

export interface UpdateBrandingInput {
  primaryColor?: string
  accentColor?: string
  neutralColor?: string
  surfaceColor?: string
  inkColor?: string
  headingFont?: string
  bodyFont?: string
  emailHeaderHtml?: string | null
  emailFooterHtml?: string | null
  logoStorageKey?: string | null
  logoDarkStorageKey?: string | null
  faviconStorageKey?: string | null
}

export interface BrandingUpdateResult {
  branding: TenantBranding
  contrastWarnings: Array<{ field: string; ratio: number | null }>
}

const CONTRAST_CHECKED_FIELDS: Array<keyof UpdateBrandingInput> = ['primaryColor', 'accentColor', 'inkColor']

export async function updateBranding(
  db: TenantDb,
  actor: Actor & { tenantId: string },
  request: AuditRequestContext,
  input: UpdateBrandingInput,
): Promise<BrandingUpdateResult> {
  const contrastWarnings: Array<{ field: string; ratio: number | null }> = []
  for (const field of CONTRAST_CHECKED_FIELDS) {
    const value = input[field]
    if (typeof value !== 'string') continue
    const result = checkContrastAgainstWhite(value)
    if (!result.passesAA) contrastWarnings.push({ field, ratio: result.ratio })
  }

  const { before, after } = await upsertBranding(db, input)
  await auditSettingsChange(actor, request, 'tenant_branding', before, after)
  return { branding: after, contrastWarnings }
}
