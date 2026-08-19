'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { tenantDb } from '@/db/tenant-db'
import { getTenantPolicy } from '@/server/context'
import { loadAssignments, loads } from '@/db/schema'
import { can, scopeFilter, type Actor, type ResourceContext } from '@/lib/permissions'
import {
  bpsSchema,
  emailSchema,
  moneyCentsSchema,
  phoneSchema,
  postalCodeSchema,
  reasonSchema,
  usStateSchema,
  uuidSchema,
} from '@/lib/validation'
import { getLoadResourceContext } from './queries'
import {
  addStop,
  assignCarrier,
  assignResources,
  cancelLoad,
  completeCheckCall,
  createLoad,
  duplicateLoad,
  recordRateConfirmationDecision,
  recordStopArrival,
  recordStopDeparture,
  removeStop,
  reorderStops,
  scheduleCheckCall,
  transitionStatus,
  unassignResource,
  updateLoad,
} from './service'
import { removeLoadDocument, uploadLoadDocument } from './documents'
import { getGeoProvider } from '@/integrations/geo'
import { availableEquipmentForLoad, type EquipmentCandidate } from '@/server/equipment/queries'
import { availableDriversForLoad, type DriverCandidate } from '@/server/drivers/queries'
import { listCarriers } from '@/server/carriers/queries'
import type { Trailer, Truck } from '@/db/schema'

/**
 * Server actions for the load domain.
 *
 * Every mutating action's `resource()` resolver pins the permission check to
 * the load's *real* facts (carrier, dispatcher, and — for a driver actor —
 * whether they are actually assigned) via `getLoadResourceContext`, which
 * runs its own short-lived `TenantDb` the same way `documents/actions.ts`
 * does (the harness has not built `ctx.db` yet when `resource()` runs).
 */

function tenantDbFor(actor: Actor) {
  if (!actor.tenantId) throw new Error('resource resolver requires a tenant-scoped actor')
  return tenantDb(actor.tenantId)
}

async function loadResource(input: { loadId: string }, ctx: { actor: Actor }): Promise<ResourceContext> {
  return getLoadResourceContext(tenantDbFor(ctx.actor), input.loadId, ctx.actor)
}

/* ── Create / update ─────────────────────────────────────────────────────── */

const stopInput = z.object({
  stopType: z.enum(['pickup', 'delivery']),
  facilityName: z.string().trim().max(200).optional().nullable(),
  customerLocationId: uuidSchema.optional().nullable(),
  line1: z.string().trim().max(200).optional().nullable(),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  state: usStateSchema.optional().nullable(),
  postalCode: postalCodeSchema.optional().nullable(),
  placeId: z.string().trim().max(255).optional().nullable(),
  contactName: z.string().trim().max(200).optional().nullable(),
  contactPhone: phoneSchema.optional().nullable(),
  contactEmail: emailSchema.optional().nullable(),
  confirmationNumber: z.string().trim().max(80).optional().nullable(),
  instructions: z.string().trim().max(2000).optional().nullable(),
  appointmentType: z.enum(['exact', 'window', 'fcfs', 'open']),
  windowStart: z.coerce.date().optional().nullable(),
  windowEnd: z.coerce.date().optional().nullable(),
})

const createLoadInput = z.object({
  customerId: uuidSchema,
  customerContactId: uuidSchema.optional().nullable(),
  carrierId: uuidSchema.optional().nullable(),
  dispatcherUserId: uuidSchema.optional().nullable(),
  customerReference: z.string().trim().max(80).optional().nullable(),
  poNumber: z.string().trim().max(80).optional().nullable(),
  commodity: z.string().trim().max(200).optional().nullable(),
  weightPounds: z.number().int().positive().optional().nullable(),
  lengthInches: z.number().int().positive().optional().nullable(),
  widthInches: z.number().int().positive().optional().nullable(),
  heightInches: z.number().int().positive().optional().nullable(),
  pieceCount: z.number().int().positive().optional().nullable(),
  requiredEquipmentTypeId: uuidSchema.optional().nullable(),
  axleConfiguration: z.string().trim().max(60).optional().nullable(),
  grossVehicleWeightPounds: z.number().int().positive().optional().nullable(),
  specialInstructions: z.string().trim().max(2000).optional().nullable(),
  internalNotes: z.string().trim().max(2000).optional().nullable(),
  customerChargeCents: moneyCentsSchema.optional(),
  carrierGrossRateCents: moneyCentsSchema.optional(),
  carrierDispatchFeeBps: bpsSchema.optional(),
  dispatcherCommissionBps: bpsSchema.optional(),
  dispatcherCommissionBasis: z.enum(['dispatch_fee_amount', 'carrier_gross_rate', 'commissionable_base']).optional(),
  stops: z.array(stopInput).min(1),
})

export const createLoadAction = defineAction({
  name: 'load.create',
  permission: 'load:create',
  input: createLoadInput,
  handler: (input, ctx) => createLoad(ctx.db, ctx.actor, input),
  audit: (_input, output) => ({
    action: 'load.created',
    entityType: 'load',
    entityId: output.load.id,
    entityLabel: output.load.loadNumber,
  }),
})

const updateLoadInput = z.object({
  loadId: uuidSchema,
  customerId: uuidSchema.optional(),
  customerContactId: uuidSchema.optional().nullable(),
  dispatcherUserId: uuidSchema.optional().nullable(),
  customerReference: z.string().trim().max(80).optional().nullable(),
  poNumber: z.string().trim().max(80).optional().nullable(),
  commodity: z.string().trim().max(200).optional().nullable(),
  weightPounds: z.number().int().positive().optional().nullable(),
  lengthInches: z.number().int().positive().optional().nullable(),
  widthInches: z.number().int().positive().optional().nullable(),
  heightInches: z.number().int().positive().optional().nullable(),
  pieceCount: z.number().int().positive().optional().nullable(),
  requiredEquipmentTypeId: uuidSchema.optional().nullable(),
  axleConfiguration: z.string().trim().max(60).optional().nullable(),
  grossVehicleWeightPounds: z.number().int().positive().optional().nullable(),
  specialInstructions: z.string().trim().max(2000).optional().nullable(),
  internalNotes: z.string().trim().max(2000).optional().nullable(),
  customerChargeCents: moneyCentsSchema.optional(),
  carrierGrossRateCents: moneyCentsSchema.optional(),
  carrierDispatchFeeBps: bpsSchema.optional(),
  dispatcherCommissionBps: bpsSchema.optional(),
  dispatcherCommissionBasis: z.enum(['dispatch_fee_amount', 'carrier_gross_rate', 'commissionable_base']).optional(),
})

export const updateLoadAction = defineAction({
  name: 'load.update',
  permission: 'load:update',
  input: updateLoadInput,
  resource: loadResource,
  handler: (input, ctx) => updateLoad(ctx.db, ctx.actor, input.loadId, input),
  audit: (input, output) =>
    input.customerChargeCents !== undefined ||
    input.carrierGrossRateCents !== undefined ||
    input.carrierDispatchFeeBps !== undefined ||
    input.dispatcherCommissionBps !== undefined ||
    input.dispatcherCommissionBasis !== undefined
      ? {
          action: 'financial.changed',
          entityType: 'load',
          entityId: output.id,
          entityLabel: output.loadNumber,
        }
      : null,
})

/* ── Carrier assignment ──────────────────────────────────────────────────── */

const assignCarrierInput = z.object({ loadId: uuidSchema, carrierId: uuidSchema })

export const assignCarrierAction = defineAction({
  name: 'load.assignCarrier',
  permission: 'load:assign_carrier',
  input: assignCarrierInput,
  resource: loadResource,
  handler: (input, ctx) => assignCarrier(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'load.assignment_changed',
    entityType: 'load',
    entityId: output.id,
    entityLabel: output.loadNumber,
    metadata: { carrierId: input.carrierId, action: 'carrier_assigned' },
  }),
})

/* ── Resource assignment ─────────────────────────────────────────────────── */

const assignResourcesInput = z.object({
  loadId: uuidSchema,
  truckIds: z.array(uuidSchema).optional(),
  trailerIds: z.array(uuidSchema).optional(),
  driverIds: z.array(uuidSchema).optional(),
})

export const assignResourcesAction = defineAction({
  name: 'load.assignResources',
  permission: 'load:assign_resources',
  input: assignResourcesInput,
  resource: loadResource,
  handler: (input, ctx) => assignResources(ctx.db, ctx.actor, input),
  audit: (input, output) =>
    output.status === 'assigned'
      ? {
          action: 'load.assignment_changed',
          entityType: 'load',
          entityId: input.loadId,
          metadata: { action: 'resources_assigned', count: output.assignments.length },
        }
      : null,
})

const unassignResourceInput = z.object({ loadId: uuidSchema, assignmentId: uuidSchema, reason: reasonSchema })

export const unassignResourceAction = defineAction({
  name: 'load.unassignResource',
  permission: 'load:assign_resources',
  input: unassignResourceInput,
  resource: loadResource,
  handler: async (input, ctx) => {
    const assignment = await ctx.db.requireById(loadAssignments, input.assignmentId, 'loadAssignment')
    if (assignment.loadId !== input.loadId) {
      throw new Error('assignment does not belong to the given load')
    }
    return unassignResource(ctx.db, ctx.actor, input)
  },
  audit: (input, output) => ({
    action: 'load.assignment_changed',
    entityType: 'load',
    entityId: input.loadId,
    reason: input.reason,
    metadata: { action: 'resource_unassigned', assignmentId: output.id },
  }),
})

/* ── Status transitions ──────────────────────────────────────────────────── */

const transitionStatusInput = z.object({
  loadId: uuidSchema,
  to: z.enum([
    'draft',
    'available',
    'assigned',
    'dispatched',
    'en_route_to_pickup',
    'at_pickup',
    'in_transit',
    'at_delivery',
    'delivered',
    'pod_received',
    'invoiced',
    'paid',
    'cancelled',
  ]),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const transitionLoadStatusAction = defineAction({
  name: 'load.transitionStatus',
  permission: 'load:status:update',
  input: transitionStatusInput,
  resource: loadResource,
  // `source` is always `'user'` here — the other sources
  // (`tracking_provider`, `system_job`, `webhook`) are set only by
  // non-action callers (jobs, webhook handlers), never by this client-facing
  // action.
  handler: (input, ctx) =>
    transitionStatus(
      ctx.db,
      ctx.actor,
      { ipAddress: ctx.request.ipAddress, userAgent: ctx.request.userAgent },
      { ...input, source: 'user' },
    ),
  audit: (input, output) => ({
    action: 'load.status_changed',
    entityType: 'load',
    entityId: output.id,
    entityLabel: output.loadNumber,
    metadata: { toStatus: input.to, source: 'user' },
  }),
})

/* ── Cancellation ────────────────────────────────────────────────────────── */

const cancelLoadInput = z.object({ loadId: uuidSchema, reason: reasonSchema })

export const cancelLoadAction = defineAction({
  name: 'load.cancel',
  permission: 'load:cancel',
  input: cancelLoadInput,
  resource: loadResource,
  handler: (input, ctx) =>
    cancelLoad(ctx.db, ctx.actor, { ipAddress: ctx.request.ipAddress, userAgent: ctx.request.userAgent }, input.loadId, input.reason),
  audit: (input, output) => ({
    action: 'load.cancelled',
    entityType: 'load',
    entityId: output.id,
    entityLabel: output.loadNumber,
    reason: input.reason,
  }),
})

/* ── Duplication ─────────────────────────────────────────────────────────── */

const duplicateLoadInput = z.object({ loadId: uuidSchema })

export const duplicateLoadAction = defineAction({
  name: 'load.duplicate',
  permission: 'load:duplicate',
  input: duplicateLoadInput,
  resource: loadResource,
  handler: (input, ctx) => duplicateLoad(ctx.db, ctx.actor, input.loadId),
  audit: (input, output) => ({
    action: 'load.duplicated',
    entityType: 'load',
    entityId: output.load.id,
    entityLabel: output.load.loadNumber,
    metadata: { duplicatedFromLoadId: input.loadId },
  }),
})

/* ── Rate confirmation ───────────────────────────────────────────────────── */

const rateConfirmationDecisionInput = z.object({
  loadId: uuidSchema,
  decision: z.enum(['accepted', 'rejected', 'changes_requested']),
  reason: z.string().trim().max(2000).optional().nullable(),
})

export const recordRateConfirmationDecisionAction = defineAction({
  name: 'load.rateConfirmation.decide',
  permission: 'load:rateconf:respond',
  input: rateConfirmationDecisionInput,
  resource: loadResource,
  handler: (input, ctx) =>
    recordRateConfirmationDecision(
      ctx.db,
      ctx.actor,
      { ipAddress: ctx.request.ipAddress, userAgent: ctx.request.userAgent },
      input,
    ),
})

/* ── Load documents ───────────────────────────────────────────────────────── */

/**
 * The subset of `documentTypeEnum` that makes sense attached directly to a
 * load — mirrors `DOCUMENT_TYPES` in `documents-tab.tsx` (see that file's
 * comment on why the list is duplicated rather than shared: the two domains
 * have no common module either is allowed to introduce).
 */
const loadDocumentTypeSchema = z.enum([
  'bol',
  'pod',
  'rate_confirmation',
  'receipt',
  'permit',
  'escort_document',
  'route_survey',
  'invoice',
  'lumper_receipt',
  'scale_ticket',
  'other',
])

const uploadLoadDocumentInput = z.object({
  loadId: uuidSchema,
  documentType: loadDocumentTypeSchema,
  stopId: uuidSchema.optional().nullable(),
  originalFilename: z.string().min(1).max(255),
  /** Base64-encoded bytes — same 15 MB cap as the generic document upload action. */
  fileBase64: z.string().min(1),
})

/**
 * The one real path that creates a `load_documents` join row (see
 * `documents.ts`'s header comment). `resource()` pins the permission check to
 * the load's real facts — a driver may only upload to a load they are
 * actually assigned to, a carrier only to their own — exactly like every
 * other load action.
 */
export const uploadLoadDocumentAction = defineAction({
  name: 'load.document.upload',
  permission: 'load:document:upload',
  input: uploadLoadDocumentInput,
  resource: loadResource,
  handler: async (input, ctx) => {
    const bytes = Buffer.from(input.fileBase64, 'base64')
    return uploadLoadDocument(ctx.db, ctx.actor, { ...input, bytes })
  },
  audit: (input, output) => ({
    action: 'document.uploaded',
    entityType: 'load',
    entityId: input.loadId,
    metadata: {
      documentId: output.document.id,
      documentType: input.documentType,
      versionNumber: output.version.versionNumber,
    },
  }),
})

const removeLoadDocumentInput = z.object({
  loadId: uuidSchema,
  documentId: uuidSchema,
  reason: z.string().trim().max(500).optional().nullable(),
})

export const removeLoadDocumentAction = defineAction({
  name: 'load.document.remove',
  permission: 'load:document:upload',
  input: removeLoadDocumentInput,
  resource: loadResource,
  handler: (input, ctx) => removeLoadDocument(ctx.db, ctx.actor, input),
  audit: (input, output) => ({
    action: 'document.deleted',
    entityType: 'load',
    entityId: input.loadId,
    reason: input.reason ?? 'not provided',
    metadata: { documentId: output.id },
  }),
})

/* ── Stop management ─────────────────────────────────────────────────────── */

const addStopInput = stopInput.extend({ loadId: uuidSchema, sequence: z.number().int().positive().optional() })

export const addLoadStopAction = defineAction({
  name: 'load.stop.add',
  permission: 'load:update',
  input: addStopInput,
  resource: loadResource,
  handler: (input, ctx) => addStop(ctx.db, ctx.actor, input),
})

const reorderStopsInput = z.object({ loadId: uuidSchema, stopIds: z.array(uuidSchema).min(1) })

export const reorderLoadStopsAction = defineAction({
  name: 'load.stop.reorder',
  permission: 'load:update',
  input: reorderStopsInput,
  resource: loadResource,
  handler: (input, ctx) => reorderStops(ctx.db, ctx.actor, input.loadId, input.stopIds),
})

const removeStopInput = z.object({ loadId: uuidSchema, stopId: uuidSchema })

export const removeLoadStopAction = defineAction({
  name: 'load.stop.remove',
  permission: 'load:update',
  input: removeStopInput,
  resource: loadResource,
  handler: (input, ctx) => removeStop(ctx.db, ctx.actor, input.loadId, input.stopId),
})

const stopArrivalInput = z.object({ loadId: uuidSchema, stopId: uuidSchema, arrivedAt: z.coerce.date() })

export const recordStopArrivalAction = defineAction({
  name: 'load.stop.recordArrival',
  permission: 'load:update',
  input: stopArrivalInput,
  resource: loadResource,
  handler: (input, ctx) => recordStopArrival(ctx.db, ctx.actor, input),
})

const stopDepartureInput = z.object({
  loadId: uuidSchema,
  stopId: uuidSchema,
  departedAt: z.coerce.date(),
  detentionNotes: z.string().trim().max(2000).optional().nullable(),
})

export const recordStopDepartureAction = defineAction({
  name: 'load.stop.recordDeparture',
  permission: 'load:update',
  input: stopDepartureInput,
  resource: loadResource,
  handler: (input, ctx) => recordStopDeparture(ctx.db, ctx.actor, input),
})

/* ── Check calls ─────────────────────────────────────────────────────────── */

const scheduleCheckCallInput = z.object({
  loadId: uuidSchema,
  scheduledFor: z.coerce.date(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const scheduleCheckCallAction = defineAction({
  name: 'load.checkCall.schedule',
  permission: 'load:update',
  input: scheduleCheckCallInput,
  resource: loadResource,
  handler: (input, ctx) => scheduleCheckCall(ctx.db, ctx.actor, input),
})

const completeCheckCallInput = z.object({
  loadId: uuidSchema,
  checkCallId: uuidSchema,
  notes: z.string().trim().max(2000).optional().nullable(),
  locationSummary: z.string().trim().max(200).optional().nullable(),
})

export const completeCheckCallAction = defineAction({
  name: 'load.checkCall.complete',
  permission: 'load:update',
  input: completeCheckCallInput,
  resource: loadResource,
  handler: (input, ctx) => completeCheckCall(ctx.db, ctx.actor, input),
})

/* ── Assignment candidates (backs the assign-resources dialog) ──────────── */

export interface AssignmentCandidates {
  trucks: EquipmentCandidate<Truck>[]
  trailers: EquipmentCandidate<Trailer>[]
  drivers: DriverCandidate[]
}

const listAssignmentCandidatesInput = z.object({ loadId: uuidSchema })

/**
 * Candidates come from the equipment and driver read models
 * (`availableEquipmentForLoad` / `availableDriversForLoad`) — this action
 * only adds the load-specific plumbing: resolving the carrier and the
 * commitment window those queries need, and refusing outright (with the
 * same message the dialog shows) when no carrier is assigned yet.
 */
export const listAssignmentCandidatesAction = defineAction({
  name: 'load.assignResources.listCandidates',
  permission: 'load:assign_resources',
  input: listAssignmentCandidatesInput,
  resource: loadResource,
  handler: async (input, ctx): Promise<AssignmentCandidates> => {
    const load = await ctx.db.requireById(loads, input.loadId, 'load')
    if (!load.carrierId) return { trucks: [], trailers: [], drivers: [] }

    const window = {
      from: load.plannedPickupAt ?? new Date(),
      to: load.plannedDeliveryAt ?? load.plannedPickupAt ?? new Date(),
    }

    const [trucks, trailers, drivers] = await Promise.all([
      availableEquipmentForLoad(ctx.db, input.loadId, window, { equipmentType: 'truck', carrierId: load.carrierId }),
      availableEquipmentForLoad(ctx.db, input.loadId, window, { equipmentType: 'trailer', carrierId: load.carrierId }),
      availableDriversForLoad(ctx.db, input.loadId, window, { carrierId: load.carrierId }),
    ])
    return { trucks: trucks as EquipmentCandidate<Truck>[], trailers: trailers as EquipmentCandidate<Trailer>[], drivers }
  },
})

/* ── Address autocomplete (backs stop address entry) ─────────────────────── */

const stopAddressAutocompleteInput = z.object({ query: z.string().trim().max(200) })

export interface StopAddressAutocompleteResult {
  id: string
  label: string
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
}

/**
 * Backs `AddressField`'s `fetchSuggestions` for stop entry. See the near-
 * identical comment on `customer/actions.ts::addressAutocompleteAction` —
 * duplicated rather than shared because the two domains have no common
 * module either is allowed to introduce.
 */
export const stopAddressAutocompleteAction = defineAction({
  name: 'load.stop.address.autocomplete',
  permission: 'load:update',
  input: stopAddressAutocompleteInput,
  handler: async (input): Promise<StopAddressAutocompleteResult[]> => {
    if (input.query.trim().length < 2) return []
    const geo = getGeoProvider()
    const suggestions = (await geo.autocomplete(input.query, 'load-stop-address')).slice(0, 6)
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

/* ── Carrier autocomplete (backs the assign-carrier picker) ──────────────── */

const carrierAutocompleteInput = z.object({ query: z.string().trim().max(200) })

export interface CarrierAutocompleteResult {
  id: string
  legalName: string
  dotNumber: string | null
  mcNumber: string | null
}

/**
 * `carriers/queries.ts` has no autocomplete helper of its own (its list is
 * paginated table data, not a picker) — this composes `listCarriers` with a
 * scope resolved from the acting user's own `carrier:read` grant, exactly
 * the way a page component would, since this is a plain read with no load
 * to pin a narrower resource check to.
 */
export const carrierAutocompleteAction = defineAction({
  name: 'load.assignCarrier.autocomplete',
  permission: 'load:assign_carrier',
  input: carrierAutocompleteInput,
  handler: async (input, ctx): Promise<CarrierAutocompleteResult[]> => {
    if (input.query.trim().length < 2) return []
    const policy = await getTenantPolicy(ctx.actor.tenantId)
    const decision = can(ctx.actor, 'carrier:read', undefined, policy)
    if (!decision.allowed || !decision.scope) return []
    const scope = scopeFilter(ctx.actor, decision.scope)
    const result = await listCarriers(ctx.db, scope, { search: input.query, pagination: { page: 1, pageSize: 10 } })
    return result.carriers.map((c) => ({ id: c.id, legalName: c.legalName, dotNumber: c.dotNumber, mcNumber: c.mcNumber }))
  },
})
