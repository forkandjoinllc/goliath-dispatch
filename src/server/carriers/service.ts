import 'server-only'
import { and, eq, isNull, ne } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  carrierDispatcherAssignments,
  carrierOnboardingEvents,
  carrierOnboardings,
  carriers,
  dispatcherGroups,
  documents,
  groupMembers,
  jobQueue,
  type Carrier,
  type CarrierDispatcherAssignment,
  type CarrierOnboarding,
  type DispatcherGroup,
  type GroupMember,
} from '@/db/schema'
import { AppError, conflict, notFound } from '@/lib/errors'
import { newId, sealIdentifier } from '@/lib/crypto'
import { evaluateCarrierReadinessForApproval } from '@/server/compliance/service'
import { emitNotification } from '@/server/notifications/dispatch'

/**
 * A masked field is "not supplied" only when the caller omits the key
 * entirely (`undefined`); an explicit empty string clears it. A value that
 * still contains the mask character is refused outright — mirrors
 * `drivers/service.ts`'s identical guard for the licence number, the other
 * masked-at-rest identifier in the product.
 */
function assertNotMaskedValue(value: string): void {
  if (value.includes('•')) {
    throw new AppError('validation_failed', 'validation.required')
  }
}

/**
 * The carrier + onboarding domain.
 *
 * As with `documents/service.ts`, nothing here checks permissions — that
 * already happened in `defineAction` before the handler runs. This layer
 * owns the business rules: DOT uniqueness, the onboarding state machine, the
 * "exactly one primary dispatcher" invariant, and keeping the carrier row's
 * denormalized `onboardingStatus` in sync with `carrierOnboardings.status`.
 */

/* ── Required document checklist ────────────────────────────────────────── */

const BASE_REQUIRED_DOCUMENT_TYPES = ['certificate_of_authority', 'certificate_of_insurance', 'w9'] as const
const FACTORING_REQUIRED_DOCUMENT_TYPES = ['notice_of_assignment', 'change_of_payee'] as const

export function requiredDocumentTypesFor(usesFactoring: boolean): string[] {
  return usesFactoring
    ? [...BASE_REQUIRED_DOCUMENT_TYPES, ...FACTORING_REQUIRED_DOCUMENT_TYPES]
    : [...BASE_REQUIRED_DOCUMENT_TYPES]
}

async function enqueueFmcsaVerificationJob(db: TenantDb, carrierId: string): Promise<void> {
  const dedupeKey = `carrier.fmcsa_verify:${carrierId}`
  const alreadyQueued = await db.exists(jobQueue, eq(jobQueue.dedupeKey, dedupeKey))
  if (alreadyQueued) return
  await db.insert(jobQueue, { jobType: 'carrier.fmcsa_verify', payload: { carrierId }, dedupeKey })
}

/* ── Create ──────────────────────────────────────────────────────────────── */

export interface CreateCarrierInput {
  legalName: string
  dba?: string | null
  dotNumber: string
  mcNumber?: string | null
  ein: string
  contactFirstName: string
  contactLastName: string
  email: string
  phone: string
  website?: string | null
  preferredLocale: 'en' | 'es'
  physicalLine1?: string | null
  physicalLine2?: string | null
  physicalCity?: string | null
  physicalState?: string | null
  physicalPostalCode?: string | null
  mailingSameAsPhysical: boolean
  mailingLine1?: string | null
  mailingLine2?: string | null
  mailingCity?: string | null
  mailingState?: string | null
  mailingPostalCode?: string | null
  usesFactoring: boolean
  dispatchFeeBps?: number
  notes?: string | null
}

export interface CreateCarrierResult {
  carrier: Carrier
  onboarding: CarrierOnboarding
}

/**
 * Creates the carrier, its onboarding checklist and its first onboarding
 * event, then enqueues the initial FMCSA verification job — all in one
 * transaction, so a carrier never exists without an onboarding row.
 */
export async function createCarrier(
  db: TenantDb,
  actor: { userId: string },
  input: CreateCarrierInput,
): Promise<CreateCarrierResult> {
  const dotTaken = await db.exists(carriers, eq(carriers.dotNumber, input.dotNumber))
  if (dotTaken) {
    throw conflict('errors.duplicateDot', { dot: input.dotNumber })
  }

  const sealedEin = sealIdentifier(input.ein, 'carrier.ein')
  const requiredDocumentTypes = requiredDocumentTypesFor(input.usesFactoring)

  return db.transaction(async (tx) => {
    const carrier = await tx.insert(carriers, {
      legalName: input.legalName,
      dba: input.dba ?? null,
      dotNumber: input.dotNumber,
      mcNumber: input.mcNumber ?? null,
      einEncrypted: sealedEin.encrypted,
      einLast4: sealedEin.last4,
      contactFirstName: input.contactFirstName,
      contactLastName: input.contactLastName,
      email: input.email,
      phone: input.phone,
      website: input.website ?? null,
      preferredLocale: input.preferredLocale,
      physicalLine1: input.physicalLine1 ?? null,
      physicalLine2: input.physicalLine2 ?? null,
      physicalCity: input.physicalCity ?? null,
      physicalState: input.physicalState ?? null,
      physicalPostalCode: input.physicalPostalCode ?? null,
      mailingSameAsPhysical: input.mailingSameAsPhysical,
      mailingLine1: input.mailingSameAsPhysical ? (input.physicalLine1 ?? null) : (input.mailingLine1 ?? null),
      mailingLine2: input.mailingSameAsPhysical ? (input.physicalLine2 ?? null) : (input.mailingLine2 ?? null),
      mailingCity: input.mailingSameAsPhysical ? (input.physicalCity ?? null) : (input.mailingCity ?? null),
      mailingState: input.mailingSameAsPhysical ? (input.physicalState ?? null) : (input.mailingState ?? null),
      mailingPostalCode: input.mailingSameAsPhysical
        ? (input.physicalPostalCode ?? null)
        : (input.mailingPostalCode ?? null),
      dispatchFeeBps: input.dispatchFeeBps ?? 1000,
      usesFactoring: input.usesFactoring,
      notes: input.notes ?? null,
      onboardingStatus: 'draft',
      fmcsaStatus: 'not_started',
      lastActivityAt: new Date(),
    })

    const onboarding = await tx.insert(carrierOnboardings, {
      carrierId: carrier.id,
      status: 'draft',
      requiredDocumentTypes,
      checklist: requiredDocumentTypes.map((key) => ({ key, complete: false, blocking: true })),
    })

    await tx.insert(carrierOnboardingEvents, {
      onboardingId: onboarding.id,
      fromStatus: null,
      toStatus: 'draft',
      actorUserId: actor.userId,
      reason: null,
    })

    await enqueueFmcsaVerificationJob(tx, carrier.id)

    return { carrier, onboarding }
  })
}

/* ── Update ──────────────────────────────────────────────────────────────── */

export interface UpdateCarrierInput {
  legalName?: string
  dba?: string | null
  dotNumber?: string
  mcNumber?: string | null
  ein?: string
  contactFirstName?: string
  contactLastName?: string
  email?: string
  phone?: string
  website?: string | null
  preferredLocale?: 'en' | 'es'
  physicalLine1?: string | null
  physicalLine2?: string | null
  physicalCity?: string | null
  physicalState?: string | null
  physicalPostalCode?: string | null
  mailingSameAsPhysical?: boolean
  mailingLine1?: string | null
  mailingLine2?: string | null
  mailingCity?: string | null
  mailingState?: string | null
  mailingPostalCode?: string | null
  usesFactoring?: boolean
  notes?: string | null
}

export interface UpdateCarrierResult {
  carrier: Carrier
  changedFields: string[]
  dotNumberChanged: boolean
}

/**
 * General carrier-company-data edit — legal name, contact, addresses, EIN,
 * DOT/MC, factoring flag, notes. The dispatch fee has its own dedicated,
 * reason-required action (`setCarrierDispatchFeeAction`) and is deliberately
 * not editable here.
 *
 *  - EIN is re-sealed only when a *new*, unmasked value is supplied — the
 *    caller omits the key entirely to leave the stored ciphertext untouched,
 *    exactly like `drivers/service.ts`'s licence number.
 *  - Changing the DOT number re-triggers FMCSA verification (a changed DOT
 *    invalidates whatever was last verified against the old one) and resets
 *    `fmcsaStatus` to `not_started` so the compliance gate reflects "needs
 *    reverification" immediately instead of showing a stale result.
 *  - Returns every field name that actually changed; the caller (the
 *    `carrier.update` action) uses that to write a complete audit diff —
 *    this function never writes the audit log itself.
 */
export async function updateCarrier(
  db: TenantDb,
  _actor: { userId: string },
  carrierId: string,
  patch: UpdateCarrierInput,
): Promise<UpdateCarrierResult> {
  const existing = await db.requireById(carriers, carrierId, 'carrier')

  if (patch.dotNumber !== undefined && patch.dotNumber !== existing.dotNumber) {
    const dotTaken = await db.exists(carriers, and(eq(carriers.dotNumber, patch.dotNumber), ne(carriers.id, carrierId))!)
    if (dotTaken) throw conflict('errors.duplicateDot', { dot: patch.dotNumber })
  }

  const values: Record<string, unknown> = {}
  const changedFields: string[] = []
  const track = (key: keyof Carrier, next: unknown) => {
    if (next === undefined) return
    if ((existing as Record<string, unknown>)[key] === next) return
    values[key] = next
    changedFields.push(key)
  }

  track('legalName', patch.legalName)
  track('dba', patch.dba)
  track('mcNumber', patch.mcNumber)
  track('contactFirstName', patch.contactFirstName)
  track('contactLastName', patch.contactLastName)
  track('email', patch.email)
  track('phone', patch.phone)
  track('website', patch.website)
  track('preferredLocale', patch.preferredLocale)
  track('physicalLine1', patch.physicalLine1)
  track('physicalLine2', patch.physicalLine2)
  track('physicalCity', patch.physicalCity)
  track('physicalState', patch.physicalState)
  track('physicalPostalCode', patch.physicalPostalCode)
  track('mailingSameAsPhysical', patch.mailingSameAsPhysical)
  track('usesFactoring', patch.usesFactoring)
  track('notes', patch.notes)

  // Mirrors `createCarrier`'s own rule: when the mailing address tracks the
  // physical one, every mailing column is derived from the (possibly just
  // updated) physical address rather than left stale.
  const mailingSame = patch.mailingSameAsPhysical ?? existing.mailingSameAsPhysical
  if (mailingSame) {
    track('mailingLine1', patch.physicalLine1 ?? existing.physicalLine1)
    track('mailingLine2', patch.physicalLine2 ?? existing.physicalLine2)
    track('mailingCity', patch.physicalCity ?? existing.physicalCity)
    track('mailingState', patch.physicalState ?? existing.physicalState)
    track('mailingPostalCode', patch.physicalPostalCode ?? existing.physicalPostalCode)
  } else {
    track('mailingLine1', patch.mailingLine1)
    track('mailingLine2', patch.mailingLine2)
    track('mailingCity', patch.mailingCity)
    track('mailingState', patch.mailingState)
    track('mailingPostalCode', patch.mailingPostalCode)
  }

  let dotNumberChanged = false
  if (patch.dotNumber !== undefined && patch.dotNumber !== existing.dotNumber) {
    values.dotNumber = patch.dotNumber
    values.fmcsaStatus = 'not_started'
    values.fmcsaNextVerificationAt = null
    changedFields.push('dotNumber')
    dotNumberChanged = true
  }

  if (patch.ein !== undefined && patch.ein !== '') {
    assertNotMaskedValue(patch.ein)
    const sealed = sealIdentifier(patch.ein, 'carrier.ein')
    if (sealed.last4 !== existing.einLast4) {
      values.einEncrypted = sealed.encrypted
      values.einLast4 = sealed.last4
      changedFields.push('ein')
    }
  }

  if (changedFields.length === 0) {
    return { carrier: existing, changedFields, dotNumberChanged }
  }

  values.lastActivityAt = new Date()

  return db.transaction(async (tx) => {
    const updated = await tx.update(carriers, carrierId, values as Partial<Carrier>)
    if (!updated) throw notFound('errors.notFound', { entity: 'carrier' })

    if (dotNumberChanged) {
      // A fresh, always-unique dedupe key: `carrier.fmcsa_verify:${carrierId}`
      // (used by `createCarrier`) is already consumed forever by the initial
      // verification job's row, so re-using it here would silently no-op via
      // `onConflictDoNothing`.
      await tx.insert(jobQueue, {
        jobType: 'carrier.fmcsa_verify',
        payload: { carrierId },
        dedupeKey: `carrier.fmcsa_verify:${carrierId}:dot_change:${newId()}`,
      })
    }

    return { carrier: updated, changedFields, dotNumberChanged }
  })
}

/* ── Onboarding state machine ────────────────────────────────────────────── */

type OnboardingStatus = CarrierOnboarding['status']

const ONBOARDING_TRANSITIONS: Record<OnboardingStatus, OnboardingStatus[]> = {
  draft: ['submitted'],
  submitted: ['under_review', 'corrections_required', 'rejected'],
  under_review: ['corrections_required', 'approved', 'rejected'],
  corrections_required: ['submitted'],
  approved: ['suspended'],
  rejected: [],
  suspended: ['approved'],
}

const REASON_REQUIRED_TRANSITIONS = new Set<OnboardingStatus>(['corrections_required', 'rejected'])

export interface TransitionOnboardingOptions {
  reason?: string | null
}

/**
 * The full onboarding state machine. An illegal transition is a `conflict`
 * AppError; `corrections_required` and `rejected` cannot be reached without a
 * written reason. Every transition writes a `carrierOnboardingEvents` row.
 */
export async function transitionOnboarding(
  db: TenantDb,
  actor: { userId: string },
  carrierId: string,
  toStatus: OnboardingStatus,
  options: TransitionOnboardingOptions = {},
): Promise<CarrierOnboarding> {
  const onboarding = await db.findFirst(carrierOnboardings, { where: eq(carrierOnboardings.carrierId, carrierId) })
  if (!onboarding) throw notFound('errors.notFound', { entity: 'carrierOnboarding' })

  const fromStatus = onboarding.status
  const allowed = ONBOARDING_TRANSITIONS[fromStatus] ?? []
  if (!allowed.includes(toStatus)) {
    throw conflict('onboarding.errors.invalidTransition', { from: fromStatus, to: toStatus })
  }

  if (REASON_REQUIRED_TRANSITIONS.has(toStatus) && !options.reason?.trim()) {
    throw new AppError('validation_failed', 'validation.required')
  }

  const now = new Date()
  const patch: Partial<CarrierOnboarding> = { status: toStatus }

  if (toStatus === 'submitted') patch.submittedAt = now
  if (toStatus === 'under_review') patch.reviewStartedAt = now
  if (toStatus === 'corrections_required') {
    patch.correctionsRequestedAt = now
    patch.correctionNotes = options.reason ?? null
  }
  if (toStatus === 'approved' || toStatus === 'rejected') {
    patch.decidedAt = now
    patch.decidedByUserId = actor.userId
  }
  if (toStatus === 'rejected') patch.rejectionReason = options.reason ?? null

  const updated = await db.transaction(async (tx) => {
    const row = await tx.update(carrierOnboardings, onboarding.id, patch)
    if (!row) throw notFound('errors.notFound', { entity: 'carrierOnboarding' })

    await tx.update(carriers, carrierId, { onboardingStatus: toStatus, lastActivityAt: now })

    await tx.insert(carrierOnboardingEvents, {
      onboardingId: onboarding.id,
      fromStatus,
      toStatus,
      actorUserId: actor.userId,
      reason: options.reason ?? null,
    })

    return row
  })

  // `onboarding.corrections_required`/`.approved`/`.rejected` are real
  // entries in `NOTIFICATION_CATALOG` (`server/notifications/catalog.ts`)
  // with their own recipients and copy, but nothing ever called
  // `emitNotification()` for them — every other transition this catalog
  // covers (a document expiring, an invoice going overdue) is driven by a
  // scheduled job, and onboarding transitions have no equivalent job, so
  // the catalog entries were unreachable dead code and Accounting/Admin
  // never actually got notified that a carrier needed corrections or had
  // been approved/rejected. Fired after the transaction commits — a
  // notification for a transition that then rolled back would be worse
  // than a merely late one.
  if (toStatus === 'corrections_required' || toStatus === 'approved' || toStatus === 'rejected') {
    const carrier = await db.findFirst(carriers, { where: eq(carriers.id, carrierId) })
    if (carrier) {
      const eventKey =
        toStatus === 'corrections_required'
          ? ('onboarding.corrections_required' as const)
          : toStatus === 'approved'
            ? ('onboarding.approved' as const)
            : ('onboarding.rejected' as const)
      await emitNotification({
        tenantId: db.tenantId,
        eventKey,
        subject: { type: 'carrier', id: carrierId },
        audience: { carrierId },
        tokens: { carrierName: carrier.legalName, notes: options.reason ?? '', reason: options.reason ?? '' },
      })
    }
  }

  return updated
}

/** Required document types not yet uploaded — what `submitOnboarding` refuses on. */
export async function missingRequiredDocuments(db: TenantDb, carrierId: string): Promise<string[]> {
  const onboarding = await db.findFirst(carrierOnboardings, { where: eq(carrierOnboardings.carrierId, carrierId) })
  const requiredTypes = onboarding?.requiredDocumentTypes ?? []
  if (requiredTypes.length === 0) return []

  const ownedDocuments = await db.findMany(documents, {
    where: and(eq(documents.ownerType, 'carrier'), eq(documents.ownerId, carrierId))!,
  })
  const present = new Set<string>(ownedDocuments.map((d) => d.documentType))
  return requiredTypes.filter((type) => !present.has(type))
}

/** Draft → Submitted, refusing when a required document has not been uploaded yet. */
export async function submitOnboarding(
  db: TenantDb,
  actor: { userId: string },
  carrierId: string,
): Promise<CarrierOnboarding> {
  const missing = await missingRequiredDocuments(db, carrierId)
  if (missing.length > 0) {
    throw new AppError('validation_failed', 'onboarding.errors.missingDocuments', {
      params: { documents: missing.join(', ') },
    })
  }
  return transitionOnboarding(db, actor, carrierId, 'submitted')
}

/**
 * Admin/Accounting only. Approval is refused while any blocking compliance
 * reason stands (`evaluateCarrier`) — an override that has already flipped
 * `fmcsaStatus` to `manually_overridden` clears its own blocking reason, so
 * no separate override check is needed here.
 */
export async function approveOnboarding(
  db: TenantDb,
  actor: { userId: string },
  carrierId: string,
): Promise<CarrierOnboarding> {
  const compliance = await evaluateCarrierReadinessForApproval(db, carrierId)
  if (!compliance.ok) {
    throw new AppError('compliance_blocked', 'onboarding.errors.blockedByCompliance', {
      params: { count: compliance.blocking.length },
    })
  }

  return db.transaction(async (tx) => {
    const onboarding = await transitionOnboarding(tx, actor, carrierId, 'approved')
    await tx.update(carriers, carrierId, { approvedAt: new Date(), approvedByUserId: actor.userId })
    return onboarding
  })
}

export async function rejectOnboarding(
  db: TenantDb,
  actor: { userId: string },
  carrierId: string,
  reason: string,
): Promise<CarrierOnboarding> {
  return transitionOnboarding(db, actor, carrierId, 'rejected', { reason })
}

/* ── Suspension ──────────────────────────────────────────────────────────── */

export async function suspendCarrier(
  db: TenantDb,
  actor: { userId: string },
  carrierId: string,
  reason: string,
): Promise<Carrier> {
  if (!reason?.trim()) throw new AppError('validation_failed', 'validation.required')

  return db.transaction(async (tx) => {
    await transitionOnboarding(tx, actor, carrierId, 'suspended', { reason })
    const updated = await tx.update(carriers, carrierId, { suspendedAt: new Date(), suspensionReason: reason })
    if (!updated) throw notFound('errors.notFound', { entity: 'carrier' })
    return updated
  })
}

export async function reactivateCarrier(
  db: TenantDb,
  actor: { userId: string },
  carrierId: string,
  reason: string,
): Promise<Carrier> {
  if (!reason?.trim()) throw new AppError('validation_failed', 'validation.required')

  return db.transaction(async (tx) => {
    await transitionOnboarding(tx, actor, carrierId, 'approved', { reason })
    const updated = await tx.update(carriers, carrierId, { suspendedAt: null, suspensionReason: null })
    if (!updated) throw notFound('errors.notFound', { entity: 'carrier' })
    return updated
  })
}

/* ── Dispatcher assignment ───────────────────────────────────────────────── */

export interface AssignDispatcherInput {
  carrierId: string
  dispatcherUserId: string
  reason?: string | null
}

/** Admin only. Creates a (non-primary) assignment; use `setPrimaryDispatcher` for primacy. */
export async function assignDispatcher(
  db: TenantDb,
  actor: { userId: string },
  input: AssignDispatcherInput,
): Promise<CarrierDispatcherAssignment> {
  return db.insert(carrierDispatcherAssignments, {
    carrierId: input.carrierId,
    dispatcherUserId: input.dispatcherUserId,
    isPrimary: false,
    startDate: new Date(),
    assignedByUserId: actor.userId,
    reason: input.reason ?? null,
  })
}

export interface RemoveDispatcherInput {
  carrierId: string
  dispatcherUserId: string
  reason?: string | null
}

/** Ends the active assignment window; the row itself is retained as history. */
export async function removeDispatcher(
  db: TenantDb,
  _actor: { userId: string },
  input: RemoveDispatcherInput,
): Promise<CarrierDispatcherAssignment[]> {
  const rows = await db.updateWhere(
    carrierDispatcherAssignments,
    and(
      eq(carrierDispatcherAssignments.carrierId, input.carrierId),
      eq(carrierDispatcherAssignments.dispatcherUserId, input.dispatcherUserId),
      isNull(carrierDispatcherAssignments.endDate),
    )!,
    { endDate: new Date(), reason: input.reason ?? null },
  )
  if (rows.length === 0) throw notFound('errors.notFound', { entity: 'carrierDispatcherAssignment' })
  return rows
}

export interface SetPrimaryDispatcherInput {
  carrierId: string
  dispatcherUserId: string
  reason?: string | null
}

/**
 * Demotes any current primary for the carrier and promotes (or creates) the
 * assignment for the given dispatcher — the transaction is what guarantees
 * exactly one primary dispatcher per carrier at any instant.
 */
export async function setPrimaryDispatcher(
  db: TenantDb,
  actor: { userId: string },
  input: SetPrimaryDispatcherInput,
): Promise<CarrierDispatcherAssignment> {
  return db.transaction(async (tx) => {
    await tx.updateWhere(
      carrierDispatcherAssignments,
      and(
        eq(carrierDispatcherAssignments.carrierId, input.carrierId),
        eq(carrierDispatcherAssignments.isPrimary, true),
        isNull(carrierDispatcherAssignments.endDate),
      )!,
      { isPrimary: false },
    )

    const existing = await tx.findFirst(carrierDispatcherAssignments, {
      where: and(
        eq(carrierDispatcherAssignments.carrierId, input.carrierId),
        eq(carrierDispatcherAssignments.dispatcherUserId, input.dispatcherUserId),
        isNull(carrierDispatcherAssignments.endDate),
      )!,
    })

    if (existing) {
      const updated = await tx.update(carrierDispatcherAssignments, existing.id, { isPrimary: true })
      if (!updated) throw notFound('errors.notFound', { entity: 'carrierDispatcherAssignment' })
      return updated
    }

    return tx.insert(carrierDispatcherAssignments, {
      carrierId: input.carrierId,
      dispatcherUserId: input.dispatcherUserId,
      isPrimary: true,
      startDate: new Date(),
      assignedByUserId: actor.userId,
      reason: input.reason ?? null,
    })
  })
}

/* ── Financial ───────────────────────────────────────────────────────────── */

/** Admin only. The action wrapper records this as a `financial.changed` audit event. */
export async function setCarrierDispatchFee(db: TenantDb, carrierId: string, dispatchFeeBps: number): Promise<Carrier> {
  const updated = await db.update(carriers, carrierId, { dispatchFeeBps })
  if (!updated) throw notFound('errors.notFound', { entity: 'carrier' })
  return updated
}

/* ── Groups ──────────────────────────────────────────────────────────────── */

export interface CreateGroupInput {
  name: string
  description?: string | null
}

export async function createGroup(
  db: TenantDb,
  actor: { userId: string },
  input: CreateGroupInput,
): Promise<DispatcherGroup> {
  return db.insert(dispatcherGroups, {
    name: input.name,
    description: input.description ?? null,
    ownerDispatcherUserId: actor.userId,
    active: true,
  })
}

export type GroupMemberType = 'carrier' | 'truck' | 'trailer' | 'driver'

export interface GroupMemberInput {
  groupId: string
  memberType: GroupMemberType
  memberId: string
}

export async function addGroupMember(
  db: TenantDb,
  actor: { userId: string },
  input: GroupMemberInput,
): Promise<GroupMember> {
  await db.requireById(dispatcherGroups, input.groupId, 'dispatcherGroup')
  return db.insert(groupMembers, {
    groupId: input.groupId,
    memberType: input.memberType,
    memberId: input.memberId,
    addedByUserId: actor.userId,
  })
}

export async function removeGroupMember(
  db: TenantDb,
  actor: { userId: string },
  input: GroupMemberInput & { reason?: string | null },
): Promise<GroupMember> {
  const existing = await db.findFirst(groupMembers, {
    where: and(
      eq(groupMembers.groupId, input.groupId),
      eq(groupMembers.memberType, input.memberType),
      eq(groupMembers.memberId, input.memberId),
    )!,
  })
  if (!existing) throw notFound('errors.notFound', { entity: 'groupMember' })
  const updated = await db.softDelete(groupMembers, existing.id, actor.userId, input.reason ?? undefined)
  if (!updated) throw notFound('errors.notFound', { entity: 'groupMember' })
  return updated
}
