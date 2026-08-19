'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { tenantDb } from '@/db/tenant-db'
import { escorts, permits } from '@/db/schema'
import type { Actor, ResourceContext } from '@/lib/permissions'
import { moneyCentsSchema, uuidSchema, usStateSchema } from '@/lib/validation'
import { getLoadResourceContext } from '@/server/loads/queries'
import {
  approvePermitReady,
  createEscort,
  createPermit,
  updateEscort,
  updatePermit,
  type DocumentUploadInput,
} from './service'

/**
 * Server actions for permits and escorts. Documents travel the same way
 * every other upload in the app does — base64 in the action payload,
 * decoded to a `Buffer` before it reaches `service.ts` — matching
 * `documents/actions.ts`.
 */

function tenantDbFor(actor: Actor) {
  if (!actor.tenantId) throw new Error('resource resolver requires a tenant-scoped actor')
  return tenantDb(actor.tenantId)
}

async function loadResource(input: { loadId: string }, ctx: { actor: Actor }): Promise<ResourceContext> {
  return getLoadResourceContext(tenantDbFor(ctx.actor), input.loadId, ctx.actor)
}

async function permitResource(
  input: { loadId: string; permitId: string },
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  const db = tenantDbFor(ctx.actor)
  const permit = await db.findById(permits, input.permitId)
  if (!permit || permit.loadId !== input.loadId) return { tenantId: ctx.actor.tenantId }
  return getLoadResourceContext(db, permit.loadId, ctx.actor)
}

async function escortResource(
  input: { loadId: string; escortId: string },
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  const db = tenantDbFor(ctx.actor)
  const escort = await db.findById(escorts, input.escortId)
  if (!escort || escort.loadId !== input.loadId) return { tenantId: ctx.actor.tenantId }
  return getLoadResourceContext(db, escort.loadId, ctx.actor)
}

const documentUploadSchema = z.object({ originalFilename: z.string().min(1).max(255), fileBase64: z.string().min(1) })

function toUploadInput(doc?: z.infer<typeof documentUploadSchema> | null): DocumentUploadInput | null {
  if (!doc) return null
  return { originalFilename: doc.originalFilename, bytes: Buffer.from(doc.fileBase64, 'base64') }
}

const permitStatusSchema = z.enum(['pending', 'requested', 'issued', 'expired', 'rejected', 'not_required'])
const escortStatusSchema = z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'not_required'])
const escortTypeSchema = z.enum(['pilot_car', 'police', 'height_pole', 'route_survey'])

/* ── Permits ─────────────────────────────────────────────────────────────── */

const createPermitInput = z.object({
  loadId: uuidSchema,
  stateCode: usStateSchema,
  permitType: z.string().trim().max(60).optional().nullable(),
  permitNumber: z.string().trim().max(80).optional().nullable(),
  issuedAt: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  costCents: moneyCentsSchema.optional(),
  status: permitStatusSchema.optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  document: documentUploadSchema.optional().nullable(),
  routeSurveyDocument: documentUploadSchema.optional().nullable(),
})

export const createPermitAction = defineAction({
  name: 'permit.create',
  permission: 'permit:manage',
  input: createPermitInput,
  resource: loadResource,
  handler: (input, ctx) =>
    createPermit(ctx.db, ctx.actor, {
      ...input,
      document: toUploadInput(input.document),
      routeSurveyDocument: toUploadInput(input.routeSurveyDocument),
    }),
  audit: (input, output) => ({
    action: 'load.assignment_changed',
    entityType: 'permit',
    entityId: output.id,
    entityLabel: `${output.stateCode} ${output.permitNumber ?? ''}`.trim(),
    metadata: { action: 'permit_created', loadId: input.loadId, stateCode: output.stateCode },
  }),
})

const updatePermitInput = z.object({
  loadId: uuidSchema,
  permitId: uuidSchema,
  permitType: z.string().trim().max(60).optional().nullable(),
  permitNumber: z.string().trim().max(80).optional().nullable(),
  issuedAt: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  costCents: moneyCentsSchema.optional(),
  status: permitStatusSchema.optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  document: documentUploadSchema.optional().nullable(),
  routeSurveyDocument: documentUploadSchema.optional().nullable(),
})

export const updatePermitAction = defineAction({
  name: 'permit.update',
  permission: 'permit:manage',
  input: updatePermitInput,
  resource: permitResource,
  handler: ({ permitId, loadId: _loadId, ...input }, ctx) =>
    updatePermit(ctx.db, ctx.actor, permitId, {
      ...input,
      document: toUploadInput(input.document),
      routeSurveyDocument: toUploadInput(input.routeSurveyDocument),
    }),
  audit: (input, output) => ({
    action: 'load.assignment_changed',
    entityType: 'permit',
    entityId: output.id,
    entityLabel: `${output.stateCode} ${output.permitNumber ?? ''}`.trim(),
    metadata: { action: 'permit_updated', loadId: input.loadId, status: output.status },
  }),
})

/* ── Escorts ─────────────────────────────────────────────────────────────── */

const createEscortInput = z.object({
  loadId: uuidSchema,
  escortType: escortTypeSchema,
  stateCode: usStateSchema.optional().nullable(),
  providerName: z.string().trim().max(200).optional().nullable(),
  contactName: z.string().trim().max(200).optional().nullable(),
  contactPhone: z.string().trim().max(32).optional().nullable(),
  contactEmail: z.string().trim().max(255).optional().nullable(),
  agencyName: z.string().trim().max(200).optional().nullable(),
  scheduledFor: z.coerce.date().optional().nullable(),
  costCents: moneyCentsSchema.optional(),
  status: escortStatusSchema.optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  document: documentUploadSchema.optional().nullable(),
})

export const createEscortAction = defineAction({
  name: 'escort.create',
  permission: 'permit:manage',
  input: createEscortInput,
  resource: loadResource,
  handler: (input, ctx) => createEscort(ctx.db, ctx.actor, { ...input, document: toUploadInput(input.document) }),
  audit: (input, output) => ({
    action: 'load.assignment_changed',
    entityType: 'escort',
    entityId: output.id,
    entityLabel: output.escortType,
    metadata: { action: 'escort_created', loadId: input.loadId, escortType: output.escortType },
  }),
})

const updateEscortInput = z.object({
  loadId: uuidSchema,
  escortId: uuidSchema,
  providerName: z.string().trim().max(200).optional().nullable(),
  contactName: z.string().trim().max(200).optional().nullable(),
  contactPhone: z.string().trim().max(32).optional().nullable(),
  contactEmail: z.string().trim().max(255).optional().nullable(),
  agencyName: z.string().trim().max(200).optional().nullable(),
  scheduledFor: z.coerce.date().optional().nullable(),
  costCents: moneyCentsSchema.optional(),
  status: escortStatusSchema.optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  document: documentUploadSchema.optional().nullable(),
})

export const updateEscortAction = defineAction({
  name: 'escort.update',
  permission: 'permit:manage',
  input: updateEscortInput,
  resource: escortResource,
  handler: ({ escortId, loadId: _loadId, ...input }, ctx) =>
    updateEscort(ctx.db, ctx.actor, escortId, { ...input, document: toUploadInput(input.document) }),
  audit: (input, output) => ({
    action: 'load.assignment_changed',
    entityType: 'escort',
    entityId: output.id,
    entityLabel: output.escortType,
    metadata: { action: 'escort_updated', loadId: input.loadId, status: output.status },
  }),
})

/* ── Permit-ready approval ───────────────────────────────────────────────── */

const approvePermitReadyInput = z.object({ loadId: uuidSchema })

export const approvePermitReadyAction = defineAction({
  name: 'permit.approveReady',
  permission: 'permit:approve_ready',
  input: approvePermitReadyInput,
  resource: loadResource,
  handler: (input, ctx) => approvePermitReady(ctx.db, ctx.actor, input.loadId),
  audit: (input, output) => ({
    action: 'load.assignment_changed',
    entityType: 'load',
    entityId: output.id,
    entityLabel: output.loadNumber,
    metadata: { action: 'permit_ready_approved', loadId: input.loadId },
  }),
})
