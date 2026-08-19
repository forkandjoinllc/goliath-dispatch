'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { tenantDb } from '@/db/tenant-db'
import { loads } from '@/db/schema'
import type { Actor, ResourceContext } from '@/lib/permissions'
import { can, scopeFilter } from '@/lib/permissions'
import { getTenantPolicy } from '@/server/context'
import { listLoads } from '@/server/loads/queries'
import { listCarriers } from '@/server/carriers/queries'
import { commissionBasisEnum, expenseTreatmentEnum } from '@/db/schema/_shared'
import { bpsSchema, moneyCentsSchema, reasonSchema, uuidSchema } from '@/lib/validation'
import {
  approveExpense,
  bulkApproveExpenses,
  createExpenseCategory,
  deleteExpenseCategory,
  rejectExpense,
  submitExpense,
  updateExpenseCategory,
} from './expenses'
import { bulkTransitionCommissions, transitionCommissionStatus, type CommissionStatus } from './commissions'
import { updateLoadFinancialInputs } from './snapshots'

/**
 * Server actions for the finance domain (expenses, categories, financial
 * inputs, dispatcher commissions). Invoices, settlements and factoring each
 * have their own `actions.ts` in their own directories.
 */

function tenantContext(ctx: { actor: Actor }): { tenantId: string | null } {
  return { tenantId: ctx.actor.tenantId }
}

async function loadResource(input: { loadId?: string | null }, ctx: { actor: Actor }): Promise<ResourceContext> {
  const base = tenantContext(ctx)
  if (!input.loadId || !ctx.actor.tenantId) return base
  const load = await tenantDb(ctx.actor.tenantId).findById(loads, input.loadId)
  return { ...base, carrierId: load?.carrierId ?? null, dispatcherUserId: load?.dispatcherUserId ?? null }
}

async function expenseSubmitResource(
  input: { loadId?: string | null; carrierId?: string | null },
  ctx: { actor: Actor },
): Promise<ResourceContext> {
  const base = tenantContext(ctx)
  if (input.carrierId) return { ...base, carrierId: input.carrierId }
  return loadResource(input, ctx)
}

/* ── Expense categories ──────────────────────────────────────────────────── */

const createExpenseCategoryInput = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { message: 'validation.required' })
    .max(40)
    .regex(/^[a-z0-9_-]+$/, { message: 'validation.required' }),
  labelEn: z.string().trim().min(1, { message: 'validation.required' }).max(120),
  labelEs: z.string().trim().min(1, { message: 'validation.required' }).max(120),
  treatment: z.enum(expenseTreatmentEnum.enumValues),
  requiresReceipt: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export const createExpenseCategoryAction = defineAction({
  name: 'finance.expenseCategory.create',
  permission: 'expense:category:manage',
  input: createExpenseCategoryInput,
  handler: (input, ctx) => createExpenseCategory(ctx.db, input),
  audit: (_input, output) => ({
    action: 'settings.updated',
    entityType: 'expenseCategory',
    entityId: output.id,
    entityLabel: output.labelEn,
    metadata: { treatment: output.treatment },
  }),
})

const updateExpenseCategoryInput = z.object({
  categoryId: uuidSchema,
  labelEn: z.string().trim().min(1).max(120).optional(),
  labelEs: z.string().trim().min(1).max(120).optional(),
  treatment: z.enum(expenseTreatmentEnum.enumValues).optional(),
  requiresReceipt: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export const updateExpenseCategoryAction = defineAction({
  name: 'finance.expenseCategory.update',
  permission: 'expense:category:manage',
  input: updateExpenseCategoryInput,
  handler: (input, ctx) => updateExpenseCategory(ctx.db, input.categoryId, input),
  audit: (input, output) => ({
    action: 'settings.updated',
    entityType: 'expenseCategory',
    entityId: output.id,
    entityLabel: output.labelEn,
    metadata: { treatment: output.treatment },
  }),
})

const deleteExpenseCategoryInput = z.object({ categoryId: uuidSchema, reason: reasonSchema.optional() })

export const deleteExpenseCategoryAction = defineAction({
  name: 'finance.expenseCategory.delete',
  permission: 'expense:category:manage',
  input: deleteExpenseCategoryInput,
  handler: (input, ctx) => deleteExpenseCategory(ctx.db, ctx.actor, input.categoryId, input.reason),
  audit: (input, output) => ({
    action: 'settings.updated',
    entityType: 'expenseCategory',
    entityId: output.id,
    reason: input.reason ?? 'category removed',
  }),
})

/* ── Expense submission / review ─────────────────────────────────────────── */

const submitExpenseInput = z.object({
  loadId: uuidSchema.optional(),
  carrierId: uuidSchema.optional(),
  categoryId: uuidSchema,
  amountCents: moneyCentsSchema.refine((value) => value > 0, { message: 'validation.positive' }),
  description: z.string().trim().max(2000).optional(),
  incurredOn: z.coerce.date().optional(),
  receiptFilename: z.string().trim().min(1).max(255).optional(),
  /** Base64-encoded receipt bytes — see `document.upload` for the same convention. */
  receiptFileBase64: z.string().min(1).optional(),
})

export const submitExpenseAction = defineAction({
  name: 'finance.expense.submit',
  permission: 'expense:submit',
  input: submitExpenseInput,
  resource: (input, ctx) => expenseSubmitResource(input, ctx),
  handler: (input, ctx) =>
    submitExpense(ctx.db, ctx.actor, {
      loadId: input.loadId ?? null,
      carrierId: input.carrierId ?? null,
      categoryId: input.categoryId,
      amountCents: input.amountCents,
      description: input.description ?? null,
      incurredOn: input.incurredOn ?? null,
      receipt:
        input.receiptFileBase64 && input.receiptFilename
          ? { originalFilename: input.receiptFilename, bytes: Buffer.from(input.receiptFileBase64, 'base64') }
          : null,
    }),
  // `auditActionEnum` has no dedicated "expense submitted" action key (only
  // `expense.approved` / `expense.rejected` exist), and reusing one of those
  // for a submission would misrepresent the audit trail — so submission is
  // simply not audited as its own event. The expense row itself records
  // `submittedByUserId`/`createdAt`, which is the durable record of who
  // submitted it and when.
})

const expenseIdInput = z.object({ expenseId: uuidSchema })

async function expenseResource(input: { expenseId: string }, ctx: { actor: Actor }): Promise<ResourceContext> {
  const base = tenantContext(ctx)
  if (!ctx.actor.tenantId) return base
  const { expenses } = await import('@/db/schema')
  const expense = await tenantDb(ctx.actor.tenantId).findById(expenses, input.expenseId)
  return { ...base, carrierId: expense?.carrierId ?? null }
}

export const approveExpenseAction = defineAction({
  name: 'finance.expense.approve',
  permission: 'expense:approve',
  input: expenseIdInput,
  resource: (input, ctx) => expenseResource(input, ctx),
  handler: (input, ctx) => approveExpense(ctx.db, ctx.actor, input.expenseId),
  audit: (_input, output) => ({
    action: 'expense.approved',
    entityType: 'expense',
    entityId: output.id,
    metadata: { amountCents: output.amountCents, treatment: output.treatmentSnapshot },
  }),
})

const bulkExpenseIdsInput = z.object({ expenseIds: z.array(uuidSchema).min(1).max(200) })

export const bulkApproveExpensesAction = defineAction({
  name: 'finance.expense.bulkApprove',
  permission: 'expense:approve',
  input: bulkExpenseIdsInput,
  handler: (input, ctx) => bulkApproveExpenses(ctx.db, ctx.actor, input.expenseIds),
  audit: (input, output) => ({
    action: 'expense.approved',
    entityType: 'expense',
    metadata: { count: output.length, expenseIds: input.expenseIds },
  }),
})

const rejectExpenseInput = z.object({ expenseId: uuidSchema, reason: reasonSchema })

export const rejectExpenseAction = defineAction({
  name: 'finance.expense.reject',
  permission: 'expense:approve',
  input: rejectExpenseInput,
  resource: (input, ctx) => expenseResource(input, ctx),
  handler: (input, ctx) => rejectExpense(ctx.db, ctx.actor, input.expenseId, input.reason),
  audit: (input, output) => ({
    action: 'expense.rejected',
    entityType: 'expense',
    entityId: output.id,
    reason: input.reason,
  }),
})

/* ── Financial inputs (rate / fee / commission edits) ────────────────────── */

const updateLoadFinancialInputsInput = z.object({
  loadId: uuidSchema,
  customerChargeCents: moneyCentsSchema.optional(),
  carrierGrossRateCents: moneyCentsSchema.optional(),
  carrierDispatchFeeBps: bpsSchema.optional(),
  dispatcherCommissionBps: bpsSchema.optional(),
  dispatcherCommissionBasis: z.enum(commissionBasisEnum.enumValues).optional(),
})

export const updateLoadFinancialInputsAction = defineAction({
  name: 'finance.load.updateInputs',
  permission: 'finance:update',
  input: updateLoadFinancialInputsInput,
  resource: (input, ctx) => loadResource(input, ctx),
  handler: (input, ctx) => updateLoadFinancialInputs(ctx.db, ctx.actor, input.loadId, input),
  audit: (input, output) => ({
    action: 'financial.changed',
    entityType: 'load',
    entityId: input.loadId,
    before: output.diff.before,
    after: output.diff.after,
    reason: 'financial_inputs_updated',
  }),
})

/* ── Dispatcher commissions ──────────────────────────────────────────────── */

const commissionIdInput = z.object({ commissionId: uuidSchema })
const commissionStatusInput = z.enum(['approved', 'paid', 'voided'])

export const approveCommissionAction = defineAction({
  name: 'finance.commission.approve',
  permission: 'finance:update',
  input: commissionIdInput,
  handler: (input, ctx) => transitionCommissionStatus(ctx.db, input.commissionId, 'approved'),
  audit: (_input, output) => ({
    action: 'financial.changed',
    entityType: 'dispatcherCommission',
    entityId: output.id,
    metadata: { toStatus: output.status },
  }),
})

export const markCommissionPaidAction = defineAction({
  name: 'finance.commission.markPaid',
  permission: 'finance:update',
  input: commissionIdInput,
  handler: (input, ctx) => transitionCommissionStatus(ctx.db, input.commissionId, 'paid'),
  audit: (_input, output) => ({
    action: 'financial.changed',
    entityType: 'dispatcherCommission',
    entityId: output.id,
    metadata: { toStatus: output.status },
  }),
})

const bulkCommissionInput = z.object({
  commissionIds: z.array(uuidSchema).min(1).max(200),
  toStatus: commissionStatusInput,
})

export const bulkTransitionCommissionsAction = defineAction({
  name: 'finance.commission.bulkTransition',
  permission: 'finance:update',
  input: bulkCommissionInput,
  handler: (input, ctx) =>
    bulkTransitionCommissions(ctx.db, input.commissionIds, input.toStatus as CommissionStatus),
  audit: (input, output) => ({
    action: 'financial.changed',
    entityType: 'dispatcherCommission',
    metadata: { count: output.length, toStatus: input.toStatus },
  }),
})

/* ── Picker search helpers (load / carrier comboboxes on finance forms) ──── */

export interface PickerOption {
  value: string
  label: string
  description?: string
}

const searchQueryInput = z.object({ query: z.string().trim().max(120).optional() })

/** Backs the load combobox on the "submit an expense" form, scoped exactly like `expense:submit`. */
export const searchLoadsForExpenseAction = defineAction({
  name: 'finance.picker.searchLoads',
  permission: 'expense:submit',
  input: searchQueryInput,
  handler: async (input, ctx): Promise<PickerOption[]> => {
    const policy = await getTenantPolicy(ctx.actor.tenantId)
    const decision = can(ctx.actor, 'expense:submit', undefined, policy)
    if (!decision.allowed || !decision.scope) return []
    const scope = scopeFilter(ctx.actor, decision.scope)
    const { rows } = await listLoads(
      ctx.db,
      scope,
      { reference: input.query || undefined },
      { field: 'createdAt', direction: 'desc' },
      { page: 1, pageSize: 20 },
    )
    return rows.map((row) => ({
      value: row.load.id,
      label: row.load.loadNumber,
      description: [row.customerName, row.carrierName].filter(Boolean).join(' → '),
    }))
  },
})

/** Backs the carrier combobox on finance forms (expense submission, settlement generation). */
export const searchCarriersForFinanceAction = defineAction({
  name: 'finance.picker.searchCarriers',
  permission: 'expense:submit',
  input: searchQueryInput,
  handler: async (input, ctx): Promise<PickerOption[]> => {
    const policy = await getTenantPolicy(ctx.actor.tenantId)
    const decision = can(ctx.actor, 'carrier:read', undefined, policy)
    if (!decision.allowed || !decision.scope) return []
    const scope = scopeFilter(ctx.actor, decision.scope)
    const { carriers } = await listCarriers(ctx.db, scope, {
      search: input.query || undefined,
      pagination: { page: 1, pageSize: 20 },
    })
    return carriers.map((carrier) => ({ value: carrier.id, label: carrier.legalName }))
  },
})

/** Backs the carrier combobox on the settlement-generation form (`settlement:manage`). */
export const searchCarriersForSettlementAction = defineAction({
  name: 'finance.picker.searchCarriersForSettlement',
  permission: 'settlement:manage',
  input: searchQueryInput,
  handler: async (input, ctx): Promise<PickerOption[]> => {
    const policy = await getTenantPolicy(ctx.actor.tenantId)
    const decision = can(ctx.actor, 'carrier:read', undefined, policy)
    if (!decision.allowed || !decision.scope) return []
    const scope = scopeFilter(ctx.actor, decision.scope)
    const { carriers } = await listCarriers(ctx.db, scope, {
      search: input.query || undefined,
      pagination: { page: 1, pageSize: 20 },
    })
    return carriers.map((carrier) => ({ value: carrier.id, label: carrier.legalName }))
  },
})

/** Backs the carrier combobox on factoring-assignment forms (`factoring:manage`). */
export const searchCarriersForFactoringAction = defineAction({
  name: 'finance.picker.searchCarriersForFactoring',
  permission: 'factoring:manage',
  input: searchQueryInput,
  handler: async (input, ctx): Promise<PickerOption[]> => {
    const policy = await getTenantPolicy(ctx.actor.tenantId)
    const decision = can(ctx.actor, 'carrier:read', undefined, policy)
    if (!decision.allowed || !decision.scope) return []
    const scope = scopeFilter(ctx.actor, decision.scope)
    const { carriers } = await listCarriers(ctx.db, scope, {
      search: input.query || undefined,
      pagination: { page: 1, pageSize: 20 },
    })
    return carriers.map((carrier) => ({ value: carrier.id, label: carrier.legalName }))
  },
})
