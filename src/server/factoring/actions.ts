'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { tenantDb } from '@/db/tenant-db'
import { factoringAssignments } from '@/db/schema'
import { verificationStatusEnum } from '@/db/schema/_shared'
import type { Actor, ResourceContext } from '@/lib/permissions'
import { emailSchema, phoneSchema, postalCodeSchema, usStateSchema, uuidSchema } from '@/lib/validation'
import {
  createFactoringAssignment,
  createFactoringCompany,
  deleteFactoringCompany,
  endFactoringAssignment,
  setFactoringVerificationStatus,
  updateFactoringCompany,
  uploadFactoringDocument,
} from './service'

function tenantContext(ctx: { actor: Actor }): { tenantId: string | null } {
  return { tenantId: ctx.actor.tenantId }
}

async function assignmentResource(
  input: { assignmentId: string },
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  const base = tenantContext(ctx)
  if (!ctx.actor.tenantId) return base
  const assignment = await tenantDb(ctx.actor.tenantId).findById(factoringAssignments, input.assignmentId)
  return { ...base, carrierId: assignment?.carrierId ?? null }
}

/* ── Factoring companies ──────────────────────────────────────────────────── */

const factoringCompanyInput = z.object({
  name: z.string().trim().min(1, { message: 'validation.required' }).max(200),
  contactName: z.string().trim().max(200).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  addressLine1: z.string().trim().max(200).optional(),
  addressCity: z.string().trim().max(120).optional(),
  addressState: usStateSchema.optional(),
  addressPostalCode: postalCodeSchema.optional(),
  fundingInstructions: z.string().trim().max(4000).optional(),
})

export const createFactoringCompanyAction = defineAction({
  name: 'factoring.company.create',
  permission: 'factoring:manage',
  input: factoringCompanyInput,
  handler: (input, ctx) => createFactoringCompany(ctx.db, input),
  audit: (_input, output) => ({
    action: 'settings.updated',
    entityType: 'factoringCompany',
    entityId: output.id,
    entityLabel: output.name,
  }),
})

const updateFactoringCompanyInput = factoringCompanyInput.partial().extend({
  companyId: uuidSchema,
  active: z.boolean().optional(),
})

export const updateFactoringCompanyAction = defineAction({
  name: 'factoring.company.update',
  permission: 'factoring:manage',
  input: updateFactoringCompanyInput,
  handler: (input, ctx) => updateFactoringCompany(ctx.db, input.companyId, input),
  audit: (_input, output) => ({
    action: 'settings.updated',
    entityType: 'factoringCompany',
    entityId: output.id,
    entityLabel: output.name,
  }),
})

const deleteFactoringCompanyInput = z.object({ companyId: uuidSchema, reason: z.string().trim().max(2000).optional() })

export const deleteFactoringCompanyAction = defineAction({
  name: 'factoring.company.delete',
  permission: 'factoring:manage',
  input: deleteFactoringCompanyInput,
  handler: (input, ctx) => deleteFactoringCompany(ctx.db, ctx.actor, input.companyId, input.reason),
  audit: (input, output) => ({
    action: 'settings.updated',
    entityType: 'factoringCompany',
    entityId: output.id,
    reason: input.reason ?? 'factoring company removed',
  }),
})

/* ── Assignments ──────────────────────────────────────────────────────────── */

const createAssignmentInput = z.object({
  carrierId: uuidSchema,
  factoringCompanyId: uuidSchema,
  effectiveFrom: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
})

export const createFactoringAssignmentAction = defineAction({
  name: 'factoring.assignment.create',
  permission: 'factoring:manage',
  input: createAssignmentInput,
  resource: (input, ctx) => ({ tenantId: ctx.actor.tenantId, carrierId: input.carrierId }),
  handler: (input, ctx) =>
    createFactoringAssignment(ctx.db, {
      carrierId: input.carrierId,
      factoringCompanyId: input.factoringCompanyId,
      effectiveFrom: input.effectiveFrom ?? null,
      notes: input.notes ?? null,
    }),
  audit: (input, output) => ({
    action: 'settings.updated',
    entityType: 'factoringAssignment',
    entityId: output.id,
    metadata: { carrierId: input.carrierId, factoringCompanyId: input.factoringCompanyId },
  }),
})

const assignmentIdInput = z.object({ assignmentId: uuidSchema })

export const endFactoringAssignmentAction = defineAction({
  name: 'factoring.assignment.end',
  permission: 'factoring:manage',
  input: assignmentIdInput.extend({ effectiveTo: z.coerce.date().optional() }),
  resource: (input, ctx) => assignmentResource(input, ctx),
  handler: (input, ctx) => endFactoringAssignment(ctx.db, input.assignmentId, input.effectiveTo),
  audit: (_input, output) => ({
    action: 'settings.updated',
    entityType: 'factoringAssignment',
    entityId: output.id,
    metadata: { effectiveTo: output.effectiveTo },
  }),
})

const setVerificationInput = z.object({
  assignmentId: uuidSchema,
  status: z.enum(verificationStatusEnum.enumValues),
  reason: z.string().trim().max(2000).optional(),
})

/** The manual verification step — nothing here calls out to a factoring API. */
export const setFactoringVerificationStatusAction = defineAction({
  name: 'factoring.assignment.setVerificationStatus',
  permission: 'factoring:manage',
  input: setVerificationInput,
  resource: (input, ctx) => assignmentResource(input, ctx),
  handler: (input, ctx) =>
    setFactoringVerificationStatus(ctx.db, ctx.actor, input.assignmentId, input.status, input.reason ?? null),
  audit: (input, output) => ({
    action: 'verification.override',
    entityType: 'factoringAssignment',
    entityId: output.id,
    reason: input.reason ?? 'manual factoring verification recorded',
    metadata: { status: output.verificationStatus },
  }),
})

const uploadFactoringDocumentInput = z.object({
  assignmentId: uuidSchema,
  kind: z.enum(['notice_of_assignment', 'change_of_payee']),
  originalFilename: z.string().trim().min(1).max(255),
  fileBase64: z.string().min(1),
})

export const uploadFactoringDocumentAction = defineAction({
  name: 'factoring.assignment.uploadDocument',
  permission: 'factoring:manage',
  input: uploadFactoringDocumentInput,
  resource: (input, ctx) => assignmentResource(input, ctx),
  handler: (input, ctx) =>
    uploadFactoringDocument(ctx.db, ctx.actor, {
      assignmentId: input.assignmentId,
      kind: input.kind,
      originalFilename: input.originalFilename,
      bytes: Buffer.from(input.fileBase64, 'base64'),
    }),
  audit: (input, output) => ({
    action: 'document.uploaded',
    entityType: 'factoringAssignment',
    entityId: output.id,
    metadata: { kind: input.kind },
  }),
})
