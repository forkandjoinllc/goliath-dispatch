import 'server-only'
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  expenseCategories,
  expenses,
  loads,
  type Expense,
  type ExpenseCategory,
} from '@/db/schema'
import type { ExpenseTreatment } from '@/lib/money'
import { AppError, conflict, notFound, validationFailed } from '@/lib/errors'
import type { Actor } from '@/lib/permissions'
import type { ScopeFilter } from '@/lib/permissions/check'
import type { Pagination } from '@/lib/validation'
import { uploadDocument } from '@/server/documents/service'
import type { DocumentOwnerType } from '@/lib/storage'
import { onFinancialInputChanged } from './snapshots'

/**
 * Expense categories and expense submission/approval.
 *
 * The category's `treatment` drives the money formulas in `src/lib/money`.
 * It is snapshotted onto every expense at submission time
 * (`expenses.treatmentSnapshot`) so that editing a category later — even
 * changing its treatment — can never rewrite the math behind an already
 * computed (and possibly already-settled) financial snapshot. Every read of
 * "what treatment applied to this expense" must come from the expense row,
 * never from a live join to `expenseCategories`.
 */

/* ── System categories ───────────────────────────────────────────────────── */

export const SYSTEM_EXPENSE_CATEGORY_CODES = ['permits', 'escorts'] as const

/**
 * Idempotently ensures the two system expense categories exist for a tenant.
 * Permits and escorts ship `excluded_from_commission` and are immutable
 * (see `updateExpenseCategory` / `deleteExpenseCategory` below). This is not
 * wired into tenant provisioning (owned by the tenants/auth agent) — whoever
 * builds `tenant.created` provisioning should call this once per new tenant.
 */
export async function ensureSystemExpenseCategories(db: TenantDb): Promise<ExpenseCategory[]> {
  const existing = await db.findMany(expenseCategories, {
    where: inArray(expenseCategories.code, [...SYSTEM_EXPENSE_CATEGORY_CODES]),
  })
  const existingCodes = new Set(existing.map((c) => c.code))

  const seeds: Array<Omit<typeof expenseCategories.$inferInsert, 'tenantId'>> = [
    {
      code: 'permits',
      labelEn: 'Permits',
      labelEs: 'Permisos',
      treatment: 'excluded_from_commission',
      isSystem: true,
      requiresReceipt: true,
      sortOrder: 0,
    },
    {
      code: 'escorts',
      labelEn: 'Escorts',
      labelEs: 'Escoltas',
      treatment: 'excluded_from_commission',
      isSystem: true,
      requiresReceipt: true,
      sortOrder: 1,
    },
  ]

  const created: ExpenseCategory[] = []
  for (const seed of seeds) {
    if (!existingCodes.has(seed.code)) {
      created.push(await db.insert(expenseCategories, seed))
    }
  }
  return [...existing, ...created]
}

/* ── Category CRUD ───────────────────────────────────────────────────────── */

export interface ListExpenseCategoriesOptions {
  activeOnly?: boolean
}

export async function listExpenseCategories(
  db: TenantDb,
  options: ListExpenseCategoriesOptions = {},
): Promise<ExpenseCategory[]> {
  return db.findMany(expenseCategories, {
    where: options.activeOnly ? eq(expenseCategories.active, true) : undefined,
    orderBy: [asc(expenseCategories.sortOrder), asc(expenseCategories.labelEn)],
  })
}

export interface CreateExpenseCategoryInput {
  code: string
  labelEn: string
  labelEs: string
  treatment: ExpenseTreatment
  requiresReceipt?: boolean
  sortOrder?: number
}

/** Admin-only in practice (`expense:category:manage`); always creates a non-system category. */
export async function createExpenseCategory(
  db: TenantDb,
  input: CreateExpenseCategoryInput,
): Promise<ExpenseCategory> {
  const codeTaken = await db.exists(expenseCategories, eq(expenseCategories.code, input.code))
  if (codeTaken) {
    throw conflict('finance.errors.categoryCodeTaken', { code: input.code })
  }
  return db.insert(expenseCategories, {
    code: input.code,
    labelEn: input.labelEn,
    labelEs: input.labelEs,
    treatment: input.treatment,
    isSystem: false,
    requiresReceipt: input.requiresReceipt ?? true,
    sortOrder: input.sortOrder ?? 0,
  })
}

export interface UpdateExpenseCategoryInput {
  labelEn?: string
  labelEs?: string
  treatment?: ExpenseTreatment
  requiresReceipt?: boolean
  active?: boolean
  sortOrder?: number
}

/**
 * Permits and Escorts (and any other `isSystem` category) may be renamed or
 * toggled active/inactive, but their `treatment` is locked — the product
 * requirement is that a system category's commission treatment can never
 * change out from under already-computed math.
 */
export async function updateExpenseCategory(
  db: TenantDb,
  categoryId: string,
  input: UpdateExpenseCategoryInput,
): Promise<ExpenseCategory> {
  const category = await db.requireById(expenseCategories, categoryId, 'expenseCategory')

  if (category.isSystem && input.treatment && input.treatment !== category.treatment) {
    throw new AppError('validation_failed', 'finance.errors.systemCategoryTreatmentLocked', {
      params: { code: category.code },
    })
  }

  const updated = await db.update(expenseCategories, categoryId, {
    labelEn: input.labelEn ?? category.labelEn,
    labelEs: input.labelEs ?? category.labelEs,
    treatment: category.isSystem ? category.treatment : input.treatment ?? category.treatment,
    requiresReceipt: input.requiresReceipt ?? category.requiresReceipt,
    active: input.active ?? category.active,
    sortOrder: input.sortOrder ?? category.sortOrder,
  })
  if (!updated) throw notFound('finance.errors.categoryNotFound')
  return updated
}

/** System categories can never be deleted; a category already used by an expense cannot be either. */
export async function deleteExpenseCategory(
  db: TenantDb,
  actor: { userId: string },
  categoryId: string,
  reason?: string,
): Promise<ExpenseCategory> {
  const category = await db.requireById(expenseCategories, categoryId, 'expenseCategory')
  if (category.isSystem) {
    throw new AppError('validation_failed', 'finance.errors.systemCategoryImmutable', {
      params: { code: category.code },
    })
  }
  const inUse = await db.exists(expenses, eq(expenses.categoryId, categoryId))
  if (inUse) {
    throw conflict('finance.errors.categoryInUse', { code: category.code })
  }
  const deleted = await db.softDelete(expenseCategories, categoryId, actor.userId, reason)
  if (!deleted) throw notFound('finance.errors.categoryNotFound')
  return deleted
}

/* ── Submission ───────────────────────────────────────────────────────────── */

export interface SubmitExpenseInput {
  loadId?: string | null
  carrierId?: string | null
  categoryId: string
  amountCents: number
  description?: string | null
  incurredOn?: Date | null
  receipt?: { originalFilename: string; bytes: Buffer } | null
}

/**
 * Submits an expense by a Dispatcher, Carrier or Accounting user.
 *
 * When `loadId` is given, the load's carrier is used to populate
 * `expenses.carrierId` even if the caller did not pass one — this keeps every
 * expense scoped by carrier for the "assigned"/"carrier" permission scopes
 * without needing a join back through `loads` on every list query. The
 * category's current `treatment` is copied onto `treatmentSnapshot`; this is
 * the one and only place that copy happens.
 */
export async function submitExpense(
  db: TenantDb,
  actor: Actor,
  input: SubmitExpenseInput,
): Promise<Expense> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw validationFailed('finance.validation.amountPositive')
  }
  if (!input.loadId && !input.carrierId) {
    throw validationFailed('finance.validation.expenseNeedsLoadOrCarrier')
  }

  const category = await db.requireById(expenseCategories, input.categoryId, 'expenseCategory')
  if (!category.active) {
    throw validationFailed('finance.validation.categoryInactive')
  }
  if (category.requiresReceipt && !input.receipt) {
    throw validationFailed('finance.validation.receiptRequired')
  }

  return db.transaction(async (tx) => {
    let carrierId = input.carrierId ?? null
    if (input.loadId) {
      const load = await tx.requireById(loads, input.loadId, 'load')
      carrierId = load.carrierId ?? carrierId
    }

    let receiptDocumentId: string | null = null
    if (input.receipt) {
      const ownerType: DocumentOwnerType = input.loadId ? 'load' : 'carrier'
      const ownerId = (input.loadId ?? carrierId) as string
      const { document } = await uploadDocument(tx, actor, {
        ownerType,
        ownerId,
        documentType: 'receipt',
        originalFilename: input.receipt.originalFilename,
        bytes: input.receipt.bytes,
      })
      receiptDocumentId = document.id
    }

    return tx.insert(expenses, {
      loadId: input.loadId ?? null,
      carrierId,
      categoryId: category.id,
      // Snapshotted so a later category edit cannot rewrite settled math.
      treatmentSnapshot: category.treatment,
      amountCents: input.amountCents,
      description: input.description ?? null,
      incurredOn: input.incurredOn ?? null,
      receiptDocumentId,
      status: 'submitted',
      submittedByUserId: actor.userId,
    })
  })
}

/* ── Approval / rejection ─────────────────────────────────────────────────── */

/**
 * Approves an expense. If it belongs to a load, this triggers a financial
 * recompute (`onFinancialInputChanged`) inside the same transaction — an
 * approval and the resulting snapshot are always atomic together.
 */
export async function approveExpense(
  db: TenantDb,
  actor: Actor,
  expenseId: string,
): Promise<Expense> {
  return db.transaction(async (tx) => {
    const expense = await tx.requireById(expenses, expenseId, 'expense')
    if (expense.status === 'approved' || expense.status === 'reimbursed') return expense
    if (expense.status === 'rejected') {
      throw conflict('finance.errors.expenseAlreadyRejected')
    }

    const updated = await tx.update(expenses, expenseId, {
      status: 'approved',
      reviewedByUserId: actor.userId,
      reviewedAt: new Date(),
      rejectionReason: null,
    })
    if (!updated) throw notFound('finance.errors.expenseNotFound')

    if (updated.loadId) {
      await onFinancialInputChanged(tx, updated.loadId, {
        reason: 'expense_approved',
        actorUserId: actor.userId,
      })
    }
    return updated
  })
}

/** Approves a batch of expenses, recomputing each affected load's financials exactly once. */
export async function bulkApproveExpenses(
  db: TenantDb,
  actor: Actor,
  expenseIds: string[],
): Promise<Expense[]> {
  return db.transaction(async (tx) => {
    const updated: Expense[] = []
    const affectedLoadIds = new Set<string>()

    for (const expenseId of expenseIds) {
      const expense = await tx.requireById(expenses, expenseId, 'expense')
      if (expense.status === 'approved' || expense.status === 'reimbursed') {
        updated.push(expense)
        continue
      }
      if (expense.status === 'rejected') continue

      const row = await tx.update(expenses, expenseId, {
        status: 'approved',
        reviewedByUserId: actor.userId,
        reviewedAt: new Date(),
        rejectionReason: null,
      })
      if (row) {
        updated.push(row)
        if (row.loadId) affectedLoadIds.add(row.loadId)
      }
    }

    for (const loadId of affectedLoadIds) {
      await onFinancialInputChanged(tx, loadId, { reason: 'expense_approved', actorUserId: actor.userId })
    }
    return updated
  })
}

/** Rejection always requires a reason; an already-approved expense must be handled by an admin manually (rare). */
export async function rejectExpense(
  db: TenantDb,
  actor: Actor,
  expenseId: string,
  reason: string,
): Promise<Expense> {
  if (!reason?.trim()) {
    throw validationFailed('finance.validation.rejectionReasonRequired')
  }
  return db.transaction(async (tx) => {
    const expense = await tx.requireById(expenses, expenseId, 'expense')
    if (expense.status === 'approved' || expense.status === 'reimbursed') {
      throw conflict('finance.errors.cannotRejectApprovedExpense')
    }
    const updated = await tx.update(expenses, expenseId, {
      status: 'rejected',
      reviewedByUserId: actor.userId,
      reviewedAt: new Date(),
      rejectionReason: reason,
    })
    if (!updated) throw notFound('finance.errors.expenseNotFound')
    return updated
  })
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

function expenseScopeClause(scope: ScopeFilter): SQL | 'empty' | undefined {
  switch (scope.kind) {
    case 'assigned':
      return scope.carrierIds.length > 0 ? inArray(expenses.carrierId, scope.carrierIds) : 'empty'
    case 'carrier':
      return scope.carrierId ? eq(expenses.carrierId, scope.carrierId) : 'empty'
    case 'own':
      return eq(expenses.submittedByUserId, scope.userId)
    case 'tenant':
    case 'platform':
    default:
      return undefined
  }
}

export interface ListExpensesOptions {
  loadId?: string
  carrierId?: string
  status?: Expense['status']
  pagination?: Pagination
}

export interface ListExpensesResult {
  expenses: Expense[]
  total: number
}

export async function listExpenses(
  db: TenantDb,
  scope: ScopeFilter,
  options: ListExpensesOptions = {},
): Promise<ListExpensesResult> {
  const scoped = expenseScopeClause(scope)
  if (scoped === 'empty') return { expenses: [], total: 0 }

  const clauses: SQL[] = []
  if (scoped) clauses.push(scoped)
  if (options.loadId) clauses.push(eq(expenses.loadId, options.loadId))
  if (options.carrierId) clauses.push(eq(expenses.carrierId, options.carrierId))
  if (options.status) clauses.push(eq(expenses.status, options.status))

  const where = clauses.length > 0 ? and(...clauses) : undefined
  const pagination = options.pagination ?? { page: 1, pageSize: 25 }

  const [rows, total] = await Promise.all([
    db.findMany(expenses, {
      where,
      orderBy: desc(expenses.createdAt),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(expenses, where),
  ])
  return { expenses: rows, total }
}

/** Every expense (of any status) tied to a load — used by `groupApprovedExpenses` in `snapshots.ts`. */
export async function listExpensesForLoad(db: TenantDb, loadId: string): Promise<Expense[]> {
  return db.findMany(expenses, { where: eq(expenses.loadId, loadId), orderBy: asc(expenses.createdAt) })
}

export async function listPendingExpenseApprovals(
  db: TenantDb,
  pagination: Pagination = { page: 1, pageSize: 25 },
): Promise<ListExpensesResult> {
  const where = eq(expenses.status, 'submitted')
  const [rows, total] = await Promise.all([
    db.findMany(expenses, {
      where,
      orderBy: asc(expenses.createdAt),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(expenses, where),
  ])
  return { expenses: rows, total }
}
