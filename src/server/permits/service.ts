import 'server-only'
import { and, asc, eq, lte, ne } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { escorts, expenseCategories, loads, permits, type Escort, type Permit } from '@/db/schema'
import { complianceBlocked, notFound } from '@/lib/errors'
import type { Actor } from '@/lib/permissions'
import { permitGate } from '@/server/compliance'
import { uploadDocument } from '@/server/documents/service'
import { submitExpense } from '@/server/finance/expenses'

/**
 * Permits and escorts, scoped to a load.
 *
 * `permits.status` and `escorts.status` are exactly the facts
 * `src/server/compliance/gates.ts::permitGate` reads (via
 * `evaluateLoadForDispatch`), so nothing here duplicates that logic — this
 * file only owns the CRUD and the cost→expense bridge. Cost changes never
 * insert directly into `expenses`; they always go through
 * `src/server/finance/expenses.ts::submitExpense` so the financial recompute
 * fires and the `excluded_from_commission` treatment is applied consistently.
 */

type PermitStatus = Permit['status']
type EscortStatus = Escort['status']
type EscortType = Escort['escortType']

export interface DocumentUploadInput {
  originalFilename: string
  bytes: Buffer
}

async function categoryIdByCode(db: TenantDb, code: 'permits' | 'escorts'): Promise<string | null> {
  const category = await db.findFirst(expenseCategories, { where: eq(expenseCategories.code, code) })
  return category?.id ?? null
}

/**
 * Creates an `excluded_from_commission` expense for a permit/escort cost —
 * but only when a supporting document is attached in the same call. Both
 * system categories are seeded with `requiresReceipt: true`
 * (`finance/expenses.ts::ensureSystemExpenseCategories`), and this module
 * never fabricates a receipt to satisfy that requirement. A cost recorded
 * without a document is still saved on the permit/escort row itself and
 * visible on the load immediately — the expense (and the money it moves
 * through the commission math) simply waits until a document backs it, and
 * is created for the delta the next time one is attached.
 */
async function recordCostExpense(
  db: TenantDb,
  actor: Actor,
  input: {
    loadId: string
    categoryCode: 'permits' | 'escorts'
    amountCents: number
    description: string
    receipt: DocumentUploadInput | null
  },
): Promise<void> {
  if (input.amountCents <= 0 || !input.receipt) return
  const categoryId = await categoryIdByCode(db, input.categoryCode)
  if (!categoryId) return
  await submitExpense(db, actor, {
    loadId: input.loadId,
    categoryId,
    amountCents: input.amountCents,
    description: input.description,
    receipt: input.receipt,
  })
}

/* ── Permits ─────────────────────────────────────────────────────────────── */

export async function listPermitsForLoad(db: TenantDb, loadId: string): Promise<Permit[]> {
  return db.findMany(permits, { where: eq(permits.loadId, loadId), orderBy: asc(permits.stateCode) })
}

export async function getPermit(db: TenantDb, permitId: string): Promise<Permit> {
  return db.requireById(permits, permitId, 'permit')
}

/** Permits expiring within `withinDays`, across every load — backs the permits screen's expiry warnings. */
export async function listExpiringPermits(db: TenantDb, withinDays: number): Promise<Permit[]> {
  const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000)
  return db.findMany(permits, {
    where: and(eq(permits.status, 'issued'), lte(permits.expiresAt, cutoff))!,
    orderBy: asc(permits.expiresAt),
  })
}

export interface CreatePermitInput {
  loadId: string
  stateCode: string
  permitType?: string | null
  permitNumber?: string | null
  issuedAt?: Date | null
  expiresAt?: Date | null
  costCents?: number
  status?: PermitStatus
  notes?: string | null
  document?: DocumentUploadInput | null
  routeSurveyDocument?: DocumentUploadInput | null
}

export async function createPermit(db: TenantDb, actor: Actor, input: CreatePermitInput): Promise<Permit> {
  await db.requireById(loads, input.loadId, 'load')

  return db.transaction(async (tx) => {
    let documentId: string | null = null
    if (input.document) {
      const { document } = await uploadDocument(tx, actor, {
        ownerType: 'load',
        ownerId: input.loadId,
        documentType: 'permit',
        originalFilename: input.document.originalFilename,
        bytes: input.document.bytes,
      })
      documentId = document.id
    }

    let routeSurveyDocumentId: string | null = null
    if (input.routeSurveyDocument) {
      const { document } = await uploadDocument(tx, actor, {
        ownerType: 'load',
        ownerId: input.loadId,
        documentType: 'route_survey',
        originalFilename: input.routeSurveyDocument.originalFilename,
        bytes: input.routeSurveyDocument.bytes,
      })
      routeSurveyDocumentId = document.id
    }

    const costCents = input.costCents ?? 0
    const status: PermitStatus = input.status ?? (documentId && input.issuedAt ? 'issued' : 'pending')

    const permit = await tx.insert(permits, {
      loadId: input.loadId,
      stateCode: input.stateCode,
      permitNumber: input.permitNumber ?? null,
      permitType: input.permitType ?? null,
      issuedAt: input.issuedAt ?? null,
      expiresAt: input.expiresAt ?? null,
      costCents,
      documentId,
      routeSurveyDocumentId,
      status,
      notes: input.notes ?? null,
    })

    await recordCostExpense(tx, actor, {
      loadId: input.loadId,
      categoryCode: 'permits',
      amountCents: costCents,
      description: `Permit — ${input.stateCode}${input.permitNumber ? ` #${input.permitNumber}` : ''}`,
      receipt: input.document ?? null,
    })

    return permit
  })
}

export interface UpdatePermitInput {
  permitNumber?: string | null
  permitType?: string | null
  issuedAt?: Date | null
  expiresAt?: Date | null
  costCents?: number
  status?: PermitStatus
  notes?: string | null
  document?: DocumentUploadInput | null
  routeSurveyDocument?: DocumentUploadInput | null
}

export async function updatePermit(
  db: TenantDb,
  actor: Actor,
  permitId: string,
  input: UpdatePermitInput,
): Promise<Permit> {
  const permit = await db.requireById(permits, permitId, 'permit')

  return db.transaction(async (tx) => {
    let documentId = permit.documentId
    if (input.document) {
      const { document } = await uploadDocument(tx, actor, {
        ownerType: 'load',
        ownerId: permit.loadId,
        documentType: 'permit',
        originalFilename: input.document.originalFilename,
        bytes: input.document.bytes,
      })
      documentId = document.id
    }

    let routeSurveyDocumentId = permit.routeSurveyDocumentId
    if (input.routeSurveyDocument) {
      const { document } = await uploadDocument(tx, actor, {
        ownerType: 'load',
        ownerId: permit.loadId,
        documentType: 'route_survey',
        originalFilename: input.routeSurveyDocument.originalFilename,
        bytes: input.routeSurveyDocument.bytes,
      })
      routeSurveyDocumentId = document.id
    }

    const nextCostCents = input.costCents ?? permit.costCents
    const costDeltaCents = nextCostCents - permit.costCents

    const updated = await tx.update(permits, permitId, {
      permitNumber: input.permitNumber !== undefined ? input.permitNumber : permit.permitNumber,
      permitType: input.permitType !== undefined ? input.permitType : permit.permitType,
      issuedAt: input.issuedAt !== undefined ? input.issuedAt : permit.issuedAt,
      expiresAt: input.expiresAt !== undefined ? input.expiresAt : permit.expiresAt,
      costCents: nextCostCents,
      documentId,
      routeSurveyDocumentId,
      status: input.status ?? permit.status,
      notes: input.notes !== undefined ? input.notes : permit.notes,
    })
    if (!updated) throw notFound('errors.notFound', { entity: 'permit' })

    if (costDeltaCents > 0) {
      await recordCostExpense(tx, actor, {
        loadId: permit.loadId,
        categoryCode: 'permits',
        amountCents: costDeltaCents,
        description: `Permit — ${permit.stateCode}${updated.permitNumber ? ` #${updated.permitNumber}` : ''}`,
        receipt: input.document ?? null,
      })
    }

    return updated
  })
}

/**
 * Idempotently ensures a `pending` permit row exists for every state the
 * oversize evaluation flagged as needing one. Never touches a state that
 * already has a permit row — including one a dispatcher has already marked
 * `not_required` — so re-running an evaluation can never resurrect an
 * override.
 */
export async function ensureRequiredPermits(
  db: TenantDb,
  loadId: string,
  requiredStates: string[],
): Promise<void> {
  if (requiredStates.length === 0) return
  const existing = await db.findMany(permits, { where: eq(permits.loadId, loadId) })
  const existingStates = new Set(existing.map((p) => p.stateCode))

  for (const stateCode of requiredStates) {
    if (existingStates.has(stateCode)) continue
    await db.insert(permits, {
      loadId,
      stateCode,
      permitType: 'oversize_overweight',
      costCents: 0,
      status: 'pending',
      notes: null,
    })
    existingStates.add(stateCode)
  }
}

/* ── Escorts ─────────────────────────────────────────────────────────────── */

export async function listEscortsForLoad(db: TenantDb, loadId: string): Promise<Escort[]> {
  return db.findMany(escorts, { where: eq(escorts.loadId, loadId), orderBy: asc(escorts.scheduledFor) })
}

export async function getEscort(db: TenantDb, escortId: string): Promise<Escort> {
  return db.requireById(escorts, escortId, 'escort')
}

export interface CreateEscortInput {
  loadId: string
  escortType: EscortType
  stateCode?: string | null
  providerName?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  agencyName?: string | null
  scheduledFor?: Date | null
  costCents?: number
  status?: EscortStatus
  notes?: string | null
  document?: DocumentUploadInput | null
}

export async function createEscort(db: TenantDb, actor: Actor, input: CreateEscortInput): Promise<Escort> {
  await db.requireById(loads, input.loadId, 'load')

  return db.transaction(async (tx) => {
    let documentId: string | null = null
    if (input.document) {
      const { document } = await uploadDocument(tx, actor, {
        ownerType: 'load',
        ownerId: input.loadId,
        documentType: 'escort_document',
        originalFilename: input.document.originalFilename,
        bytes: input.document.bytes,
      })
      documentId = document.id
    }

    const costCents = input.costCents ?? 0

    const escort = await tx.insert(escorts, {
      loadId: input.loadId,
      escortType: input.escortType,
      stateCode: input.stateCode ?? null,
      providerName: input.providerName ?? null,
      contactName: input.contactName ?? null,
      contactPhone: input.contactPhone ?? null,
      contactEmail: input.contactEmail ?? null,
      agencyName: input.agencyName ?? null,
      scheduledFor: input.scheduledFor ?? null,
      costCents,
      documentId,
      status: input.status ?? 'pending',
      notes: input.notes ?? null,
    })

    await recordCostExpense(tx, actor, {
      loadId: input.loadId,
      categoryCode: 'escorts',
      amountCents: costCents,
      description: `Escort — ${input.escortType}${input.stateCode ? ` (${input.stateCode})` : ''}`,
      receipt: input.document ?? null,
    })

    return escort
  })
}

export interface UpdateEscortInput {
  providerName?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  agencyName?: string | null
  scheduledFor?: Date | null
  costCents?: number
  status?: EscortStatus
  notes?: string | null
  document?: DocumentUploadInput | null
}

export async function updateEscort(
  db: TenantDb,
  actor: Actor,
  escortId: string,
  input: UpdateEscortInput,
): Promise<Escort> {
  const escort = await db.requireById(escorts, escortId, 'escort')

  return db.transaction(async (tx) => {
    let documentId = escort.documentId
    if (input.document) {
      const { document } = await uploadDocument(tx, actor, {
        ownerType: 'load',
        ownerId: escort.loadId,
        documentType: 'escort_document',
        originalFilename: input.document.originalFilename,
        bytes: input.document.bytes,
      })
      documentId = document.id
    }

    const nextCostCents = input.costCents ?? escort.costCents
    const costDeltaCents = nextCostCents - escort.costCents

    const updated = await tx.update(escorts, escortId, {
      providerName: input.providerName !== undefined ? input.providerName : escort.providerName,
      contactName: input.contactName !== undefined ? input.contactName : escort.contactName,
      contactPhone: input.contactPhone !== undefined ? input.contactPhone : escort.contactPhone,
      contactEmail: input.contactEmail !== undefined ? input.contactEmail : escort.contactEmail,
      agencyName: input.agencyName !== undefined ? input.agencyName : escort.agencyName,
      scheduledFor: input.scheduledFor !== undefined ? input.scheduledFor : escort.scheduledFor,
      costCents: nextCostCents,
      documentId,
      status: input.status ?? escort.status,
      notes: input.notes !== undefined ? input.notes : escort.notes,
    })
    if (!updated) throw notFound('errors.notFound', { entity: 'escort' })

    if (costDeltaCents > 0) {
      await recordCostExpense(tx, actor, {
        loadId: escort.loadId,
        categoryCode: 'escorts',
        amountCents: costDeltaCents,
        description: `Escort — ${escort.escortType}${escort.stateCode ? ` (${escort.stateCode})` : ''}`,
        receipt: input.document ?? null,
      })
    }

    return updated
  })
}

/**
 * Idempotently ensures a `pending` escort row of the given type exists for
 * every state the oversize evaluation flagged as needing one. Mirrors
 * `ensureRequiredPermits` — never touches a state/type combination that
 * already has a row.
 */
export async function ensureRequiredEscorts(
  db: TenantDb,
  loadId: string,
  required: Array<{ stateCode: string; escortType: EscortType }>,
): Promise<void> {
  if (required.length === 0) return
  const existing = await db.findMany(escorts, { where: eq(escorts.loadId, loadId) })
  const existingKeys = new Set(existing.map((e) => `${e.stateCode ?? ''}:${e.escortType}`))

  for (const req of required) {
    const key = `${req.stateCode}:${req.escortType}`
    if (existingKeys.has(key)) continue
    await db.insert(escorts, {
      loadId,
      escortType: req.escortType,
      stateCode: req.stateCode,
      costCents: 0,
      status: 'pending',
    })
    existingKeys.add(key)
  }
}

/* ── Permit-ready approval ───────────────────────────────────────────────── */

/**
 * Admin-only in practice (`permit:approve_ready`). Refuses while
 * `permitGate` reports anything blocking — the same gate
 * `evaluateLoadForDispatch` uses, evaluated here against exactly the
 * permits/escorts currently on the load.
 */
export async function approvePermitReady(db: TenantDb, actor: { userId: string }, loadId: string) {
  await db.requireById(loads, loadId, 'load')

  const [permitRows, escortRows] = await Promise.all([
    db.findMany(permits, { where: and(eq(permits.loadId, loadId), ne(permits.status, 'not_required'))! }),
    db.findMany(escorts, { where: and(eq(escorts.loadId, loadId), ne(escorts.status, 'not_required'))! }),
  ])

  const result = permitGate({
    requiredPermitStates: permitRows.map((p) => ({
      stateCode: p.stateCode,
      permit: { status: p.status, expiresAt: p.expiresAt },
    })),
    requiredEscorts: escortRows.map((e) => ({ escortType: e.escortType, status: e.status })),
  })

  if (!result.ok) {
    throw complianceBlocked('errors.permitMissing', { count: result.blocking.length })
  }

  const updated = await db.update(loads, loadId, {
    permitReadyApprovedByUserId: actor.userId,
    permitReadyApprovedAt: new Date(),
  })
  if (!updated) throw notFound('errors.notFound', { entity: 'load' })
  return updated
}
