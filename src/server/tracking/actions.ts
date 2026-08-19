'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { tenantDb } from '@/db/tenant-db'
import { publicTrackingLinks, trackingSessions } from '@/db/schema'
import type { Actor, ResourceContext } from '@/lib/permissions'
import { emailSchema, uuidSchema } from '@/lib/validation'
import { serverEnv } from '@/lib/env'
import { getLoadResourceContext } from '@/server/loads/queries'
import {
  advanceMockSession,
  endTrackingSession,
  grantTrackingConsent,
  revokeTrackingConsent,
  startTrackingSession,
} from './sessions'
import { ingestEvents } from './ingest'
import { createPublicTrackingLink, revokePublicTrackingLink } from './public-links'
import { testConnection, upsertIntegrationConnection } from './integrations'

/**
 * Server actions for the tracking domain and its settings screen.
 */

function tenantDbFor(actor: Actor) {
  if (!actor.tenantId) throw new Error('resource resolver requires a tenant-scoped actor')
  return tenantDb(actor.tenantId)
}

async function loadResource(input: { loadId: string }, ctx: { actor: Actor }): Promise<ResourceContext> {
  return getLoadResourceContext(tenantDbFor(ctx.actor), input.loadId, ctx.actor)
}

async function sessionResource(
  input: { loadId: string; sessionId: string },
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  const db = tenantDbFor(ctx.actor)
  const session = await db.findById(trackingSessions, input.sessionId)
  if (!session || session.loadId !== input.loadId) return { tenantId: ctx.actor.tenantId }
  return getLoadResourceContext(db, session.loadId, ctx.actor)
}

async function linkResource(
  input: { loadId: string; linkId: string },
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  const db = tenantDbFor(ctx.actor)
  const link = await db.findById(publicTrackingLinks, input.linkId)
  if (!link || link.loadId !== input.loadId) return { tenantId: ctx.actor.tenantId }
  return getLoadResourceContext(db, link.loadId, ctx.actor)
}

async function tenantResource(_input: unknown, ctx: { actor: Actor }): Promise<ResourceContext> {
  return { tenantId: ctx.actor.tenantId }
}

/* ── Consent (self-service; scope `own`) ─────────────────────────────────── */

export const grantTrackingConsentAction = defineAction({
  name: 'tracking.consent.grant',
  permission: 'tracking:consent',
  input: z.object({}),
  handler: (_input, ctx) => grantTrackingConsent(ctx.db, ctx.actor, ctx.request),
  audit: () => ({
    action: 'tracking.consent_changed',
    entityType: 'user',
    metadata: { granted: true },
  }),
})

export const revokeTrackingConsentAction = defineAction({
  name: 'tracking.consent.revoke',
  permission: 'tracking:consent',
  input: z.object({}),
  handler: (_input, ctx) => revokeTrackingConsent(ctx.db, ctx.actor),
  audit: () => ({
    action: 'tracking.consent_changed',
    entityType: 'user',
    metadata: { granted: false },
  }),
})

/* ── Sessions ────────────────────────────────────────────────────────────── */

const startSessionInput = z.object({
  loadId: uuidSchema,
  driverId: uuidSchema,
  truckId: uuidSchema.optional().nullable(),
  providerId: z.enum(['mock', 'trucker_tools', 'macropoint', 'highway']).optional(),
})

export const startTrackingSessionAction = defineAction({
  name: 'tracking.session.start',
  permission: 'tracking:manage',
  input: startSessionInput,
  resource: loadResource,
  handler: (input, ctx) =>
    startTrackingSession(ctx.db, {
      loadId: input.loadId,
      driverId: input.driverId,
      truckId: input.truckId ?? null,
      providerId: input.providerId,
    }),
  audit: (input, output) => ({
    action: 'load.assignment_changed',
    entityType: 'trackingSession',
    entityId: output.id,
    metadata: { action: 'tracking_session_started', loadId: input.loadId, provider: output.provider },
  }),
})

const endSessionInput = z.object({ loadId: uuidSchema, sessionId: uuidSchema })

export const endTrackingSessionAction = defineAction({
  name: 'tracking.session.end',
  permission: 'tracking:manage',
  input: endSessionInput,
  resource: sessionResource,
  handler: (input, ctx) => endTrackingSession(ctx.db, input.sessionId),
  audit: (input, output) => ({
    action: 'load.assignment_changed',
    entityType: 'trackingSession',
    entityId: output.id,
    metadata: { action: 'tracking_session_ended', loadId: input.loadId },
  }),
})

/**
 * Development-only simulator, gated on `TRACKING_DEFAULT_PROVIDER === 'mock'`
 * at the server. Advances the mock provider's simulated clock and ingests
 * whatever events newly became visible through the same `ingestEvents` path
 * a real webhook would use.
 */
const advanceSessionInput = z.object({ loadId: uuidSchema, sessionId: uuidSchema, minutes: z.number().int().min(1).max(720) })

export const advanceMockSessionAction = defineAction({
  name: 'tracking.session.advance',
  permission: 'tracking:manage',
  input: advanceSessionInput,
  resource: sessionResource,
  handler: async (input, ctx) => {
    if (serverEnv().TRACKING_DEFAULT_PROVIDER !== 'mock') {
      throw new Error('The tracking simulator is only available when TRACKING_DEFAULT_PROVIDER=mock')
    }
    const events = await advanceMockSession(ctx.db, input.sessionId, input.minutes)
    return ingestEvents(ctx.db, input.sessionId, events)
  },
})

/* ── Public links ────────────────────────────────────────────────────────── */

const createLinkInput = z.object({
  loadId: uuidSchema,
  label: z.string().trim().max(120).optional().nullable(),
  recipientEmail: emailSchema.optional().nullable(),
  ttlHours: z.number().int().positive().max(24 * 30).optional(),
})

export const createPublicTrackingLinkAction = defineAction({
  name: 'tracking.link.create',
  permission: 'tracking:link:create',
  input: createLinkInput,
  resource: loadResource,
  handler: (input, ctx) =>
    createPublicTrackingLink(ctx.db, { ...input, createdByUserId: ctx.actor.userId }),
  audit: (input, output) => ({
    action: 'export.created',
    entityType: 'publicTrackingLink',
    entityId: output.link.id,
    metadata: { action: 'public_tracking_link_created', loadId: input.loadId },
  }),
})

const revokeLinkInput = z.object({ loadId: uuidSchema, linkId: uuidSchema })

export const revokePublicTrackingLinkAction = defineAction({
  name: 'tracking.link.revoke',
  permission: 'tracking:link:revoke',
  input: revokeLinkInput,
  resource: linkResource,
  handler: (input, ctx) => revokePublicTrackingLink(ctx.db, input.linkId),
  audit: (input, output) => ({
    action: 'settings.updated',
    entityType: 'publicTrackingLink',
    entityId: output.id,
    metadata: { action: 'public_tracking_link_revoked', loadId: input.loadId },
  }),
})

/* ── Integrations settings ──────────────────────────────────────────────── */

const upsertIntegrationInput = z.object({
  category: z.enum(['tracking', 'maps', 'fmcsa', 'ocr', 'email', 'sms', 'payments', 'tolls']),
  provider: z.string().trim().min(1).max(40),
  displayName: z.string().trim().max(120).optional().nullable(),
  enabled: z.boolean().optional(),
  credentials: z.record(z.string(), z.string()).optional().nullable(),
  config: z.record(z.string(), z.unknown()).optional(),
})

export const upsertIntegrationConnectionAction = defineAction({
  name: 'tracking.integration.upsert',
  permission: 'tenant:integration:update',
  input: upsertIntegrationInput,
  resource: tenantResource,
  handler: (input, ctx) => upsertIntegrationConnection(ctx.db, input),
  audit: (input) => ({
    action: 'integration.updated',
    entityType: 'integrationConnection',
    entityLabel: `${input.category}:${input.provider}`,
    metadata: { category: input.category, provider: input.provider },
  }),
})

const testConnectionInput = z.object({
  category: z.enum(['tracking', 'maps', 'fmcsa', 'ocr', 'email', 'sms', 'payments', 'tolls']),
  provider: z.string().trim().min(1).max(40),
})

export const testIntegrationConnectionAction = defineAction({
  name: 'tracking.integration.test',
  permission: 'tenant:integration:update',
  input: testConnectionInput,
  resource: tenantResource,
  handler: (input, ctx) => testConnection(ctx.db, input.category, input.provider),
})
