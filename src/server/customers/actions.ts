'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { authorize, type Actor, type ResourceContext } from '@/lib/permissions'
import {
  dotNumberSchema,
  emailSchema,
  mcNumberSchema,
  moneyCentsSchema,
  phoneSchema,
  postalCodeSchema,
  reasonSchema,
  usStateSchema,
  uuidSchema,
} from '@/lib/validation'
import {
  createContact,
  createCustomer,
  createLocation,
  deleteContact,
  deleteLocation,
  previewDuplicateCustomers,
  setPrimaryContact,
  softDeleteCustomer,
  updateContact,
  updateCustomer,
  updateLocation,
} from './service'
import { customerAutocomplete } from './queries'
import { getGeoProvider } from '@/integrations/geo'

/**
 * Server actions for the customer domain.
 *
 * Customers are tenant-shared (every role that can act on them holds the
 * `tenant` scope — see `catalog.ts`), so every `resource()` resolver here
 * only needs to assert the tenant boundary; there is no narrower scope to
 * pin to a specific customer.
 */

function tenantResource(_input: unknown, ctx: { actor: Actor }): ResourceContext {
  return { tenantId: ctx.actor.tenantId }
}

/* ── Duplicate preview ───────────────────────────────────────────────────── */

const duplicatePreviewInput = z.object({
  companyName: z.string().trim().min(1).max(200),
  dotNumber: z.string().trim().max(12).optional().nullable(),
  mcNumber: z.string().trim().max(12).optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  email: z.string().trim().max(255).optional().nullable(),
  physicalLine1: z.string().trim().max(200).optional().nullable(),
  physicalCity: z.string().trim().max(120).optional().nullable(),
  physicalState: z.string().trim().max(2).optional().nullable(),
  physicalPostalCode: z.string().trim().max(12).optional().nullable(),
})

/** Called by the create-customer form before submit to render the warning dialog inline. */
export const previewCustomerDuplicates = defineAction({
  name: 'customer.previewDuplicates',
  permission: 'customer:create',
  input: duplicatePreviewInput,
  handler: (input, ctx) => previewDuplicateCustomers(ctx.db, input),
})

/* ── Create ──────────────────────────────────────────────────────────────── */

const createCustomerInput = z.object({
  companyName: z.string().trim().min(1).max(200),
  dotNumber: dotNumberSchema.optional().nullable(),
  mcNumber: mcNumberSchema.optional().nullable(),
  website: z.string().trim().max(255).optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  email: emailSchema.optional().nullable(),
  physicalLine1: z.string().trim().max(200).optional().nullable(),
  physicalLine2: z.string().trim().max(200).optional().nullable(),
  physicalCity: z.string().trim().max(120).optional().nullable(),
  physicalState: usStateSchema.optional().nullable(),
  physicalPostalCode: postalCodeSchema.optional().nullable(),
  physicalPlaceId: z.string().trim().max(255).optional().nullable(),
  billingSameAsPhysical: z.boolean().default(true),
  billingLine1: z.string().trim().max(200).optional().nullable(),
  billingLine2: z.string().trim().max(200).optional().nullable(),
  billingCity: z.string().trim().max(120).optional().nullable(),
  billingState: usStateSchema.optional().nullable(),
  billingPostalCode: postalCodeSchema.optional().nullable(),
  taxId: z.string().trim().min(9).max(11).optional().nullable(),
  creditLimitCents: moneyCentsSchema.optional().nullable(),
  creditApproved: z.boolean().optional(),
  creditNotes: z.string().trim().max(2000).optional().nullable(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  usesFactoring: z.boolean().optional(),
  factoringCompanyName: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  overrideDuplicate: z.boolean().optional(),
  duplicateOverrideReason: reasonSchema.optional(),
})

export const createCustomerAction = defineAction({
  name: 'customer.create',
  permission: 'customer:create',
  input: createCustomerInput,
  handler: async (input, ctx) => {
    if (input.overrideDuplicate) {
      const policy = await getTenantPolicy(ctx.actor.tenantId)
      authorize(ctx.actor, 'customer:duplicate:override', { tenantId: ctx.actor.tenantId }, policy)
    }
    return createCustomer(ctx.db, ctx.actor, input)
  },
  // The audit action enum has no generic `customer.created` (equipment and
  // driver creation are the same way — see `equipment/queries.ts`'s comment
  // on why). A duplicate override is the one moment on this path that *is*
  // in the enum's vocabulary: it is exactly the "a warning was overridden
  // with a written reason" shape `verification.override` already covers.
  audit: (_input, output) =>
    output.status === 'created' && output.customer.duplicateOverrideReason
      ? {
          action: 'verification.override',
          entityType: 'customer',
          entityId: output.customer.id,
          entityLabel: output.customer.companyName,
          reason: output.customer.duplicateOverrideReason,
          metadata: { overrideType: 'duplicate_customer' },
        }
      : null,
})

/* ── Update / delete ─────────────────────────────────────────────────────── */

const updateCustomerInput = z.object({
  customerId: uuidSchema,
  companyName: z.string().trim().min(1).max(200).optional(),
  dotNumber: dotNumberSchema.optional().nullable(),
  mcNumber: mcNumberSchema.optional().nullable(),
  website: z.string().trim().max(255).optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  email: emailSchema.optional().nullable(),
  physicalLine1: z.string().trim().max(200).optional().nullable(),
  physicalLine2: z.string().trim().max(200).optional().nullable(),
  physicalCity: z.string().trim().max(120).optional().nullable(),
  physicalState: usStateSchema.optional().nullable(),
  physicalPostalCode: postalCodeSchema.optional().nullable(),
  physicalPlaceId: z.string().trim().max(255).optional().nullable(),
  billingSameAsPhysical: z.boolean().optional(),
  billingLine1: z.string().trim().max(200).optional().nullable(),
  billingLine2: z.string().trim().max(200).optional().nullable(),
  billingCity: z.string().trim().max(120).optional().nullable(),
  billingState: usStateSchema.optional().nullable(),
  billingPostalCode: postalCodeSchema.optional().nullable(),
  taxId: z.string().trim().min(9).max(11).optional().nullable(),
  creditLimitCents: moneyCentsSchema.optional().nullable(),
  creditApproved: z.boolean().optional(),
  creditNotes: z.string().trim().max(2000).optional().nullable(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  usesFactoring: z.boolean().optional(),
  factoringCompanyName: z.string().trim().max(200).optional().nullable(),
  status: z.enum(['active', 'on_hold', 'inactive']).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const updateCustomerAction = defineAction({
  name: 'customer.update',
  permission: 'customer:update',
  input: updateCustomerInput,
  resource: tenantResource,
  handler: (input, ctx) => updateCustomer(ctx.db, ctx.actor, input.customerId, input),
})

const deleteCustomerInput = z.object({ customerId: uuidSchema, reason: reasonSchema.optional() })

export const deleteCustomerAction = defineAction({
  name: 'customer.delete',
  permission: 'customer:delete',
  input: deleteCustomerInput,
  resource: tenantResource,
  handler: (input, ctx) => softDeleteCustomer(ctx.db, ctx.actor, input.customerId, input.reason),
})

/* ── Contacts ────────────────────────────────────────────────────────────── */

const createContactInput = z.object({
  customerId: uuidSchema,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: emailSchema.optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  phoneExtension: z.string().trim().max(10).optional().nullable(),
  position: z.string().trim().max(120).optional().nullable(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const createCustomerContactAction = defineAction({
  name: 'customer.contact.create',
  permission: 'customer:update',
  input: createContactInput,
  resource: tenantResource,
  handler: (input, ctx) => createContact(ctx.db, ctx.actor, input),
})

const updateContactInput = z.object({
  contactId: uuidSchema,
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: emailSchema.optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  phoneExtension: z.string().trim().max(10).optional().nullable(),
  position: z.string().trim().max(120).optional().nullable(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const updateCustomerContactAction = defineAction({
  name: 'customer.contact.update',
  permission: 'customer:update',
  input: updateContactInput,
  resource: tenantResource,
  handler: (input, ctx) => updateContact(ctx.db, ctx.actor, input),
})

const setPrimaryContactInput = z.object({ customerId: uuidSchema, contactId: uuidSchema })

export const setPrimaryCustomerContactAction = defineAction({
  name: 'customer.contact.setPrimary',
  permission: 'customer:update',
  input: setPrimaryContactInput,
  resource: tenantResource,
  handler: (input, ctx) => setPrimaryContact(ctx.db, ctx.actor, input.customerId, input.contactId),
})

const deleteContactInput = z.object({ contactId: uuidSchema, reason: reasonSchema.optional() })

export const deleteCustomerContactAction = defineAction({
  name: 'customer.contact.delete',
  permission: 'customer:update',
  input: deleteContactInput,
  resource: tenantResource,
  handler: (input, ctx) => deleteContact(ctx.db, ctx.actor, input.contactId, input.reason),
})

/* ── Locations ───────────────────────────────────────────────────────────── */

const createLocationInput = z.object({
  customerId: uuidSchema,
  name: z.string().trim().min(1).max(200),
  line1: z.string().trim().max(200).optional().nullable(),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  state: usStateSchema.optional().nullable(),
  postalCode: postalCodeSchema.optional().nullable(),
  placeId: z.string().trim().max(255).optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  hours: z.string().trim().max(200).optional().nullable(),
  instructions: z.string().trim().max(2000).optional().nullable(),
  isPrimary: z.boolean().optional(),
})

export const createCustomerLocationAction = defineAction({
  name: 'customer.location.create',
  permission: 'customer:update',
  input: createLocationInput,
  resource: tenantResource,
  handler: (input, ctx) => createLocation(ctx.db, ctx.actor, input),
})

const updateLocationInput = z.object({
  locationId: uuidSchema,
  name: z.string().trim().min(1).max(200).optional(),
  line1: z.string().trim().max(200).optional().nullable(),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  state: usStateSchema.optional().nullable(),
  postalCode: postalCodeSchema.optional().nullable(),
  placeId: z.string().trim().max(255).optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  hours: z.string().trim().max(200).optional().nullable(),
  instructions: z.string().trim().max(2000).optional().nullable(),
  isPrimary: z.boolean().optional(),
  addressChanged: z.boolean().optional(),
})

export const updateCustomerLocationAction = defineAction({
  name: 'customer.location.update',
  permission: 'customer:update',
  input: updateLocationInput,
  resource: tenantResource,
  handler: (input, ctx) => updateLocation(ctx.db, ctx.actor, input),
})

const deleteLocationInput = z.object({ locationId: uuidSchema, reason: reasonSchema.optional() })

export const deleteCustomerLocationAction = defineAction({
  name: 'customer.location.delete',
  permission: 'customer:update',
  input: deleteLocationInput,
  resource: tenantResource,
  handler: (input, ctx) => deleteLocation(ctx.db, ctx.actor, input.locationId, input.reason),
})

/* ── Autocomplete ────────────────────────────────────────────────────────── */

const autocompleteInput = z.object({ query: z.string().trim().max(200) })

export const customerAutocompleteAction = defineAction({
  name: 'customer.autocomplete',
  permission: 'customer:read',
  input: autocompleteInput,
  handler: (input, ctx) => customerAutocomplete(ctx.db, input.query),
})

/* ── Address autocomplete (physical/billing address, locations) ────────── */

const addressAutocompleteInput = z.object({ query: z.string().trim().max(200) })

export interface AddressAutocompleteResult {
  id: string
  label: string
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
}

/**
 * Backs `AddressField`'s `fetchSuggestions`. `autocomplete()` alone only
 * returns a free-text description, so each candidate is resolved to its
 * structured components up front — `AddressField` re-derives the chosen
 * suggestion by re-calling this same function and matching on `id`, so every
 * returned row must already carry the full address, not just the winner.
 * Bounded to the first 6 results to keep resolution calls cheap.
 */
export const addressAutocompleteAction = defineAction({
  name: 'customer.address.autocomplete',
  permission: 'customer:read',
  input: addressAutocompleteInput,
  handler: async (input): Promise<AddressAutocompleteResult[]> => {
    if (input.query.trim().length < 2) return []
    const geo = getGeoProvider()
    const suggestions = (await geo.autocomplete(input.query, 'customer-address')).slice(0, 6)
    const resolved = await Promise.all(suggestions.map((s) => geo.resolvePlace(s.placeId).catch(() => null)))
    return suggestions.map((suggestion, index) => {
      const address = resolved[index]
      return {
        id: suggestion.placeId,
        label: suggestion.description,
        line1: address?.line1 ?? '',
        line2: '',
        city: address?.city ?? '',
        state: address?.state ?? '',
        postalCode: address?.postal ?? '',
      }
    })
  },
})
