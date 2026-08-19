'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { authorize } from '@/lib/permissions'
import {
  bpsSchema,
  dotNumberSchema,
  einSchema,
  emailSchema,
  localeSchema,
  mcNumberSchema,
  phoneSchema,
  postalCodeSchema,
  usStateSchema,
  uuidSchema,
} from '@/lib/validation'
import { assignLead, convertLeadToCarrier, updateLeadStatus } from './service'

/**
 * Server actions for the lead-intake queue.
 *
 * `convertLeadToCarrierAction` is checked against `carrier:create` (its
 * dominant effect) plus an explicit second `authorize()` call for
 * `lead:update` inside the handler — `defineAction` only names one
 * permission, and this is the one action in the codebase that genuinely
 * needs both.
 */

const leadIdInput = z.object({ leadId: uuidSchema })

const updateStatusInput = leadIdInput.extend({
  status: z.enum(['new', 'contacted', 'qualified', 'converted', 'disqualified']),
})

export const updateLeadStatusAction = defineAction({
  name: 'lead.status.update',
  permission: 'lead:update',
  input: updateStatusInput,
  handler: (input, ctx) => updateLeadStatus(ctx.db, input.leadId, input.status),
})

const assignLeadInput = leadIdInput.extend({ assignedToUserId: uuidSchema.nullable() })

export const assignLeadAction = defineAction({
  name: 'lead.assign',
  permission: 'lead:update',
  input: assignLeadInput,
  handler: (input, ctx) => assignLead(ctx.db, input.leadId, input.assignedToUserId),
})

const addressOverrideSchema = z.object({
  line1: z.string().trim().max(200).optional().nullable(),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  state: usStateSchema.optional(),
  postalCode: postalCodeSchema.optional(),
})

const convertLeadInput = leadIdInput.extend({
  legalName: z.string().trim().min(1).max(200).optional(),
  dba: z.string().trim().max(200).optional().nullable(),
  dotNumber: dotNumberSchema.optional(),
  mcNumber: mcNumberSchema.optional().nullable(),
  ein: einSchema.optional(),
  contactFirstName: z.string().trim().min(1).max(100).optional(),
  contactLastName: z.string().trim().min(1).max(100).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  preferredLocale: localeSchema.optional(),
  physicalAddress: addressOverrideSchema.optional(),
  mailingSameAsPhysical: z.boolean().optional(),
  usesFactoring: z.boolean().optional(),
  dispatchFeeBps: bpsSchema.optional(),
})

export const convertLeadToCarrierAction = defineAction({
  name: 'lead.convertToCarrier',
  permission: 'carrier:create',
  input: convertLeadInput,
  handler: async (input, ctx) => {
    authorize(ctx.actor, 'lead:update')
    const { leadId, physicalAddress, ...overrides } = input
    return convertLeadToCarrier(ctx.db, ctx.actor, leadId, {
      ...overrides,
      physicalLine1: physicalAddress?.line1,
      physicalLine2: physicalAddress?.line2,
      physicalCity: physicalAddress?.city,
      physicalState: physicalAddress?.state,
      physicalPostalCode: physicalAddress?.postalCode,
    })
  },
  audit: (_input, output) => ({
    action: 'onboarding.status_changed',
    entityType: 'carrier',
    entityId: output.carrier.id,
    entityLabel: output.carrier.legalName,
    metadata: { convertedFromLeadId: output.lead.id, toStatus: 'draft' },
  }),
})
