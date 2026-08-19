import 'server-only'
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lte, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  carrierDispatcherAssignments,
  carrierOnboardings,
  carriers,
  documents,
  tenantSettings,
  userTenantMemberships,
  users,
  type Carrier,
  type CarrierOnboarding,
} from '@/db/schema'
import { onboardingStatusEnum } from '@/db/schema/_shared'
import type { ScopeFilter } from '@/lib/permissions/check'
import type { Pagination } from '@/lib/validation'
import { fullName } from '@/lib/utils'
import { evaluateCarrier } from '@/server/compliance/service'
import type { ComplianceReason, ComplianceResult } from '@/server/compliance/types'

/**
 * Read models for the carrier + onboarding domain.
 *
 * `listCarriers` and `onboardingBoard` both translate a `ScopeFilter` (from
 * `scopeFilter()` in `src/lib/permissions/check.ts`) into row-level
 * predicates so a dispatcher's list query can never even fetch a carrier
 * outside their assignments — the same guarantee `resourceInScope()` gives a
 * single-record read, applied to a list.
 */

function scopeClause(scope: ScopeFilter): SQL | 'empty' | undefined {
  switch (scope.kind) {
    case 'assigned':
      return scope.carrierIds.length > 0 ? inArray(carriers.id, scope.carrierIds) : 'empty'
    case 'carrier':
      return scope.carrierId ? eq(carriers.id, scope.carrierId) : 'empty'
    case 'own':
      // Carriers have no per-user "own" concept; nothing is visible at this scope.
      return 'empty'
    case 'tenant':
    case 'platform':
    default:
      return undefined
  }
}

export interface ListCarriersOptions {
  onboardingStatus?: (typeof onboardingStatusEnum.enumValues)[number]
  search?: string
  pagination?: Pagination
}

export interface ListCarriersResult {
  carriers: Carrier[]
  total: number
}

export async function listCarriers(
  db: TenantDb,
  scope: ScopeFilter,
  options: ListCarriersOptions = {},
): Promise<ListCarriersResult> {
  const scoped = scopeClause(scope)
  if (scoped === 'empty') return { carriers: [], total: 0 }

  const clauses: SQL[] = []
  if (scoped) clauses.push(scoped)
  if (options.onboardingStatus) clauses.push(eq(carriers.onboardingStatus, options.onboardingStatus))
  if (options.search) clauses.push(ilike(carriers.legalName, `%${options.search}%`))

  const where = clauses.length > 0 ? and(...clauses) : undefined
  const pagination = options.pagination ?? { page: 1, pageSize: 25 }

  const [rows, total] = await Promise.all([
    db.findMany(carriers, {
      where,
      orderBy: desc(carriers.createdAt),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(carriers, where),
  ])

  return { carriers: rows, total }
}

export async function getCarrier(db: TenantDb, carrierId: string): Promise<Carrier> {
  return db.requireById(carriers, carrierId, 'carrier')
}

export interface CarrierWithOnboarding {
  carrier: Carrier
  onboarding: CarrierOnboarding | null
}

export async function getCarrierWithOnboarding(db: TenantDb, carrierId: string): Promise<CarrierWithOnboarding> {
  const carrier = await db.requireById(carriers, carrierId, 'carrier')
  const onboarding = await db.findFirst(carrierOnboardings, {
    where: eq(carrierOnboardings.carrierId, carrierId),
  })
  return { carrier, onboarding }
}

/* ── Onboarding Kanban board ─────────────────────────────────────────────── */

export interface OnboardingBoardCard {
  carrierId: string
  legalName: string
  dotNumber: string
  onboardingStatus: string
  assignedDispatcherName: string | null
  missingDocuments: string[]
  verificationProblems: ComplianceReason[]
  documentsExpiringSoon: Array<{ documentType: string; expirationDate: Date }>
  lastActivityAt: Date | null
}

export type OnboardingBoard = Record<(typeof onboardingStatusEnum.enumValues)[number], OnboardingBoardCard[]>

function emptyBoard(): OnboardingBoard {
  const board = {} as OnboardingBoard
  for (const status of onboardingStatusEnum.enumValues) {
    board[status] = []
  }
  return board
}

/**
 * Kanban columns keyed by onboarding status. Reuses `evaluateCarrier` per
 * card so the board and the approval gate never disagree about what is
 * blocking a carrier — the trade-off is one extra round trip per card, which
 * is acceptable at onboarding-board scale (this is not a hot list view).
 */
export async function onboardingBoard(db: TenantDb, scope: ScopeFilter): Promise<OnboardingBoard> {
  const { carriers: rows } = await listCarriers(db, scope, { pagination: { page: 1, pageSize: 500 } })
  if (rows.length === 0) return emptyBoard()

  const carrierIds = rows.map((c) => c.id)
  const warningDays = (await db.findFirst(tenantSettings))?.documentExpirationWarningDays ?? 30
  const now = new Date()
  const soonCutoff = new Date(now)
  soonCutoff.setUTCDate(soonCutoff.getUTCDate() + warningDays)

  const [primaryAssignments, expiringDocs] = await Promise.all([
    db.findMany(carrierDispatcherAssignments, {
      where: and(
        inArray(carrierDispatcherAssignments.carrierId, carrierIds),
        eq(carrierDispatcherAssignments.isPrimary, true),
        isNull(carrierDispatcherAssignments.endDate),
      )!,
    }),
    db.findMany(documents, {
      where: and(
        eq(documents.ownerType, 'carrier'),
        inArray(documents.ownerId, carrierIds),
        isNotNull(documents.expirationDate),
        lte(documents.expirationDate, soonCutoff),
      )!,
    }),
  ])

  const dispatcherUserIds = [...new Set(primaryAssignments.map((a) => a.dispatcherUserId))]
  // `users` has no `tenant_id` column (identity is global; membership is what
  // scopes it) — the tenant predicate is proven via the join to
  // `userTenantMemberships` instead, which is why this reaches for the
  // explicit-predicate builder rather than `db.findMany`.
  const dispatcherUsers = dispatcherUserIds.length
    ? await db.builderRequiringExplicitTenantPredicate
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .innerJoin(
          userTenantMemberships,
          and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, db.tenantId)),
        )
        .where(inArray(users.id, dispatcherUserIds))
    : []
  const dispatcherNameById = new Map(dispatcherUsers.map((u) => [u.id, fullName(u)]))
  const primaryDispatcherByCarrier = new Map(primaryAssignments.map((a) => [a.carrierId, a.dispatcherUserId]))
  const expiringDocsByCarrier = new Map<string, Array<{ documentType: string; expirationDate: Date }>>()
  for (const doc of expiringDocs) {
    const list = expiringDocsByCarrier.get(doc.ownerId) ?? []
    list.push({ documentType: doc.documentType, expirationDate: doc.expirationDate! })
    expiringDocsByCarrier.set(doc.ownerId, list)
  }

  const board = emptyBoard()

  for (const carrier of rows) {
    const compliance: ComplianceResult = await evaluateCarrier(db, carrier.id)
    const missingDocuments = compliance.blocking
      .filter((r) => r.code === 'document_missing')
      .map((r) => String(r.params?.document ?? ''))
    const verificationProblems = [...compliance.blocking, ...compliance.warnings].filter((r) =>
      r.code.startsWith('fmcsa_'),
    )

    const card: OnboardingBoardCard = {
      carrierId: carrier.id,
      legalName: carrier.legalName,
      dotNumber: carrier.dotNumber,
      onboardingStatus: carrier.onboardingStatus,
      assignedDispatcherName:
        dispatcherNameById.get(primaryDispatcherByCarrier.get(carrier.id) ?? '') ?? null,
      missingDocuments,
      verificationProblems,
      documentsExpiringSoon: expiringDocsByCarrier.get(carrier.id) ?? [],
      lastActivityAt: carrier.lastActivityAt,
    }

    board[carrier.onboardingStatus as (typeof onboardingStatusEnum.enumValues)[number]].push(card)
  }

  return board
}

/** The same compliance result the dispatch/onboarding gates use, for a detail screen. */
export async function carrierComplianceSummary(db: TenantDb, carrierId: string): Promise<ComplianceResult> {
  return evaluateCarrier(db, carrierId)
}
