'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import type { Tenant, TenantSettings } from '@/db/schema'
import { localeSchema } from '@/lib/validation'
import {
  updateCompanyIdentity,
  updateContact,
  updateOperationalPolicy,
  updateFinancialPolicy,
  updateRetentionPolicy,
  updateBranding,
  type BrandingUpdateResult,
} from './service'

/**
 * Server actions for tenant settings. Every one requires
 * `tenant:settings:update` (tenant scope only) and every write ends in a
 * `settings.updated` audit event with a before/after diff, both enforced in
 * `src/server/settings/service.ts` — this file is only input validation and
 * the permission gate.
 */

const businessHoursSchema = z
  .array(
    z.object({
      day: z.number().int().min(0).max(6),
      open: z.string().nullable(),
      close: z.string().nullable(),
      closed: z.boolean(),
    }),
  )
  .optional()

const companyIdentityInput = z.object({
  legalName: z.string().trim().min(1).max(200).optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  defaultLocale: localeSchema.optional(),
  defaultTimezone: z.string().trim().min(1).optional(),
  customDomain: z.string().trim().max(255).optional().nullable(),
})

export const updateCompanyIdentityAction = defineAction<z.infer<typeof companyIdentityInput>, Tenant>({
  name: 'settings.company.update',
  permission: 'tenant:settings:update',
  input: companyIdentityInput,
  handler: (input, ctx) => updateCompanyIdentity(ctx.db, ctx.actor, ctx.request, input),
})

const contactInput = z.object({
  contactPhone: z.string().trim().max(32).optional().nullable(),
  contactEmail: z.string().trim().max(255).optional().nullable(),
  supportEmail: z.string().trim().max(255).optional().nullable(),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  addressCity: z.string().trim().max(120).optional().nullable(),
  addressState: z.string().trim().max(2).optional().nullable(),
  addressPostalCode: z.string().trim().max(12).optional().nullable(),
  businessHours: businessHoursSchema,
  socialLinks: z.record(z.string(), z.string()).optional(),
})

export const updateContactAction = defineAction<z.infer<typeof contactInput>, TenantSettings>({
  name: 'settings.contact.update',
  permission: 'tenant:settings:update',
  input: contactInput,
  handler: (input, ctx) => updateContact(ctx.db, ctx.actor, ctx.request, input),
})

const operationalPolicyInput = z.object({
  documentExpirationWarningDays: z.number().int().min(1).max(365).optional(),
  fmcsaReverificationDays: z.number().int().min(1).max(365).optional(),
  allowDispatcherResourceAssignment: z.boolean().optional(),
  requireOversizeAdminValidation: z.boolean().optional(),
  loadNumberPrefix: z.string().trim().min(1).max(12).optional(),
  invoiceNumberPrefix: z.string().trim().min(1).max(12).optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
  publicTrackingEnabled: z.boolean().optional(),
  publicTrackingTokenTtlHours: z.number().int().min(1).max(24 * 30).optional(),
})

export const updateOperationalPolicyAction = defineAction<z.infer<typeof operationalPolicyInput>, TenantSettings>({
  name: 'settings.operational.update',
  permission: 'tenant:settings:update',
  input: operationalPolicyInput,
  handler: (input, ctx) => updateOperationalPolicy(ctx.db, ctx.actor, ctx.request, input),
})

const financialPolicyInput = z.object({
  defaultCarrierDispatchFeeBps: z.number().int().min(0).max(10_000).optional(),
  defaultDispatcherCommissionBps: z.number().int().min(0).max(10_000).optional(),
  dispatcherCommissionBasis: z.enum(['dispatch_fee_amount', 'carrier_gross_rate', 'commissionable_base']).optional(),
})

export const updateFinancialPolicyAction = defineAction<z.infer<typeof financialPolicyInput>, TenantSettings>({
  name: 'settings.financial.update',
  permission: 'tenant:settings:update',
  input: financialPolicyInput,
  handler: (input, ctx) => updateFinancialPolicy(ctx.db, ctx.actor, ctx.request, input),
})

const retentionPolicyInput = z.object({
  operationalActiveMonths: z.number().int().min(1).max(600).optional(),
  operationalPurgeYearsAfterArchive: z.number().int().min(0).max(100).optional(),
  financialRetentionYears: z.number().int().min(1).max(100).optional(),
})

export const updateRetentionPolicyAction = defineAction<z.infer<typeof retentionPolicyInput>, TenantSettings>({
  name: 'settings.retention.update',
  permission: 'tenant:settings:update',
  input: retentionPolicyInput,
  handler: (input, ctx) => updateRetentionPolicy(ctx.db, ctx.actor, ctx.request, input),
})

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'validation.hexColor')

const brandingInput = z.object({
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  neutralColor: hexColor.optional(),
  surfaceColor: hexColor.optional(),
  inkColor: hexColor.optional(),
  headingFont: z.string().trim().max(80).optional(),
  bodyFont: z.string().trim().max(80).optional(),
  emailHeaderHtml: z.string().max(20_000).optional().nullable(),
  emailFooterHtml: z.string().max(20_000).optional().nullable(),
  logoStorageKey: z.string().optional().nullable(),
  logoDarkStorageKey: z.string().optional().nullable(),
  faviconStorageKey: z.string().optional().nullable(),
})

export const updateBrandingAction = defineAction<z.infer<typeof brandingInput>, BrandingUpdateResult>({
  name: 'settings.branding.update',
  permission: 'tenant:settings:update',
  input: brandingInput,
  handler: (input, ctx) => updateBranding(ctx.db, ctx.actor, ctx.request, input),
})
