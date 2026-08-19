import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import {
  auditable,
  cents,
  commissionBasisEnum,
  expenseStatusEnum,
  expenseTreatmentEnum,
  invoiceStatusEnum,
  paymentMethodEnum,
  paymentStatusEnum,
  primaryId,
  retention,
  timestamps,
} from './_shared'
import { tenants } from './tenant'
import { users } from './auth'
import { carriers, factoringCompanies } from './carrier'
import { customers } from './customer'
import { loads } from './load'
import { documents } from './document'

/* ── Expenses ────────────────────────────────────────────────────────────── */

export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 40 }).notNull(),
    labelEn: varchar('label_en', { length: 120 }).notNull(),
    labelEs: varchar('label_es', { length: 120 }).notNull(),
    /** Drives the money formulas — see docs/architecture.md §Financial engine. */
    treatment: expenseTreatmentEnum('treatment').notNull().default('tenant_absorbed'),
    /** Permits and escorts ship as excluded-by-default system categories. */
    isSystem: boolean('is_system').notNull().default(false),
    requiresReceipt: boolean('requires_receipt').notNull().default(true),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...auditable,
  },
  (t) => [
    uniqueIndex('expense_categories_tenant_code_uq').on(t.tenantId, t.code),
    index('expense_categories_tenant_idx').on(t.tenantId),
  ],
)

export const expenses = pgTable(
  'expenses',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id').references(() => loads.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id').references(() => carriers.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => expenseCategories.id),
    /** Snapshotted so a later category edit cannot rewrite settled math. */
    treatmentSnapshot: expenseTreatmentEnum('treatment_snapshot').notNull(),
    amountCents: cents('amount_cents').notNull(),
    description: text('description'),
    incurredOn: timestamp('incurred_on', { withTimezone: true }),
    receiptDocumentId: uuid('receipt_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    status: expenseStatusEnum('status').notNull().default('submitted'),
    submittedByUserId: uuid('submitted_by_user_id')
      .notNull()
      .references(() => users.id),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('expenses_tenant_idx').on(t.tenantId),
    index('expenses_load_idx').on(t.loadId),
    index('expenses_carrier_idx').on(t.carrierId),
    index('expenses_status_idx').on(t.tenantId, t.status),
  ],
)

/* ── Financial snapshots ─────────────────────────────────────────────────── */

/**
 * Immutable calculation history. Every change to any input writes a new row;
 * rows are never updated, so historical results stay reproducible even after
 * tenant settings, fee percentages or category treatments change.
 */
export const financialSnapshots = pgTable(
  'financial_snapshots',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),

    // Inputs (snapshotted)
    customerChargeCents: cents('customer_charge_cents').notNull(),
    carrierGrossRateCents: cents('carrier_gross_rate_cents').notNull(),
    carrierDispatchFeeBps: integer('carrier_dispatch_fee_bps').notNull(),
    dispatcherCommissionBps: integer('dispatcher_commission_bps').notNull(),
    dispatcherCommissionBasis: commissionBasisEnum('dispatcher_commission_basis').notNull(),
    approvedExcludedExpensesCents: cents('approved_excluded_expenses_cents').notNull().default(0),
    approvedReimbursableExpensesCents: cents('approved_reimbursable_expenses_cents')
      .notNull()
      .default(0),
    tenantAbsorbedExpensesCents: cents('tenant_absorbed_expenses_cents').notNull().default(0),
    carrierDeductionsCents: cents('carrier_deductions_cents').notNull().default(0),

    // Outputs
    commissionableBaseCents: cents('commissionable_base_cents').notNull(),
    dispatchFeeAmountCents: cents('dispatch_fee_amount_cents').notNull(),
    netCarrierSettlementCents: cents('net_carrier_settlement_cents').notNull(),
    grossMarginCents: cents('gross_margin_cents').notNull(),
    dispatcherCommissionAmountCents: cents('dispatcher_commission_amount_cents').notNull(),

    /** Every expense that fed this snapshot, by id and treatment. */
    expenseBreakdown: jsonb('expense_breakdown')
      .$type<Array<{ expenseId: string; treatment: string; amountCents: number }>>()
      .notNull()
      .default([]),
    formulaVersion: varchar('formula_version', { length: 20 }).notNull().default('v1'),
    reason: varchar('reason', { length: 120 }),
    computedByUserId: uuid('computed_by_user_id').references(() => users.id),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    ...retention,
  },
  (t) => [
    uniqueIndex('financial_snapshots_load_version_uq').on(t.loadId, t.version),
    index('financial_snapshots_tenant_idx').on(t.tenantId),
    index('financial_snapshots_load_idx').on(t.loadId, t.computedAt),
  ],
)

export const dispatcherCommissions = pgTable(
  'dispatcher_commissions',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    dispatcherUserId: uuid('dispatcher_user_id')
      .notNull()
      .references(() => users.id),
    financialSnapshotId: uuid('financial_snapshot_id')
      .notNull()
      .references(() => financialSnapshots.id),
    basis: commissionBasisEnum('basis').notNull(),
    basisAmountCents: cents('basis_amount_cents').notNull(),
    percentageBps: integer('percentage_bps').notNull(),
    amountCents: cents('amount_cents').notNull(),
    /** accrued | approved | paid | voided */
    status: varchar('status', { length: 20 }).notNull().default('accrued'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('dispatcher_commissions_tenant_idx').on(t.tenantId),
    index('dispatcher_commissions_user_idx').on(t.tenantId, t.dispatcherUserId),
    uniqueIndex('dispatcher_commissions_snapshot_uq').on(t.financialSnapshotId, t.dispatcherUserId),
  ],
)

/* ── Invoices ────────────────────────────────────────────────────────────── */

/** Goliath Dispatch invoices the CARRIER for the dispatch fee. */
export const invoices = pgTable(
  'invoices',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceNumber: varchar('invoice_number', { length: 40 }).notNull(),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id),
    /** Optional: some tenants also bill the customer directly. */
    customerId: uuid('customer_id').references(() => customers.id),
    loadId: uuid('load_id').references(() => loads.id),
    status: invoiceStatusEnum('status').notNull().default('draft'),

    subtotalCents: cents('subtotal_cents').notNull().default(0),
    adjustmentsCents: cents('adjustments_cents').notNull().default(0),
    totalCents: cents('total_cents').notNull().default(0),
    amountPaidCents: cents('amount_paid_cents').notNull().default(0),
    balanceCents: cents('balance_cents').notNull().default(0),

    issueDate: timestamp('issue_date', { withTimezone: true }),
    dueDate: timestamp('due_date', { withTimezone: true }),
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    disputedAt: timestamp('disputed_at', { withTimezone: true }),
    disputeReason: text('dispute_reason'),
    uncollectableAt: timestamp('uncollectable_at', { withTimezone: true }),

    pdfDocumentId: uuid('pdf_document_id').references(() => documents.id, { onDelete: 'set null' }),
    stripeInvoiceId: varchar('stripe_invoice_id', { length: 255 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    notes: text('notes'),
    ...auditable,
    ...retention,
  },
  (t) => [
    uniqueIndex('invoices_tenant_number_uq').on(t.tenantId, t.invoiceNumber),
    index('invoices_tenant_idx').on(t.tenantId),
    index('invoices_tenant_status_idx').on(t.tenantId, t.status),
    index('invoices_carrier_idx').on(t.tenantId, t.carrierId),
    index('invoices_due_idx').on(t.tenantId, t.dueDate),
    index('invoices_load_idx').on(t.loadId),
  ],
)

export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id').references(() => loads.id),
    sequence: integer('sequence').notNull().default(0),
    descriptionEn: varchar('description_en', { length: 255 }).notNull(),
    descriptionEs: varchar('description_es', { length: 255 }),
    quantity: integer('quantity').notNull().default(1),
    unitAmountCents: cents('unit_amount_cents').notNull(),
    amountCents: cents('amount_cents').notNull(),
    /** dispatch_fee | expense | adjustment | credit */
    kind: varchar('kind', { length: 20 }).notNull().default('dispatch_fee'),
    ...auditable,
  },
  (t) => [
    index('invoice_line_items_tenant_idx').on(t.tenantId),
    index('invoice_line_items_invoice_idx').on(t.invoiceId, t.sequence),
  ],
)

/* ── Payments ────────────────────────────────────────────────────────────── */

export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amountCents: cents('amount_cents').notNull(),
    method: paymentMethodEnum('method').notNull(),
    status: paymentStatusEnum('status').notNull().default('pending'),
    reference: varchar('reference', { length: 120 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    stripeChargeId: varchar('stripe_charge_id', { length: 255 }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    refundedAmountCents: cents('refunded_amount_cents').notNull().default(0),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    disputedAt: timestamp('disputed_at', { withTimezone: true }),
    disputeReason: text('dispute_reason'),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id),
    notes: text('notes'),
    ...auditable,
    ...retention,
  },
  (t) => [
    index('payments_tenant_idx').on(t.tenantId),
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_status_idx').on(t.tenantId, t.status),
    uniqueIndex('payments_stripe_intent_uq').on(t.stripePaymentIntentId),
  ],
)

export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    method: paymentMethodEnum('method').notNull(),
    amountCents: cents('amount_cents').notNull(),
    status: paymentStatusEnum('status').notNull(),
    failureCode: varchar('failure_code', { length: 80 }),
    failureMessage: text('failure_message'),
    idempotencyKey: varchar('idempotency_key', { length: 120 }),
    providerReference: varchar('provider_reference', { length: 255 }),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('payment_attempts_tenant_idx').on(t.tenantId),
    index('payment_attempts_invoice_idx').on(t.invoiceId, t.attemptedAt),
    uniqueIndex('payment_attempts_idempotency_uq').on(t.idempotencyKey),
  ],
)

/** Stripe webhook ledger — the idempotency guard for event replay. */
export const stripeEvents = pgTable(
  'stripe_events',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    stripeEventId: varchar('stripe_event_id', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 120 }).notNull(),
    apiVersion: varchar('api_version', { length: 40 }),
    /** received | processed | ignored | failed */
    processingStatus: varchar('processing_status', { length: 20 }).notNull().default('received'),
    payloadDigest: varchar('payload_digest', { length: 64 }),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('stripe_events_event_id_uq').on(t.stripeEventId),
    index('stripe_events_type_idx').on(t.eventType),
    index('stripe_events_status_idx').on(t.processingStatus),
  ],
)

/* ── Settlements ─────────────────────────────────────────────────────────── */

export const carrierSettlements = pgTable(
  'carrier_settlements',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id),
    settlementNumber: varchar('settlement_number', { length: 40 }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    grossRateCents: cents('gross_rate_cents').notNull().default(0),
    reimbursementsCents: cents('reimbursements_cents').notNull().default(0),
    dispatchFeesCents: cents('dispatch_fees_cents').notNull().default(0),
    deductionsCents: cents('deductions_cents').notNull().default(0),
    netAmountCents: cents('net_amount_cents').notNull().default(0),
    /** draft | issued | paid | voided */
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    factoringCompanyId: uuid('factoring_company_id').references(() => factoringCompanies.id),
    /** Manual factoring: the platform records, it does not fund. */
    factoringSubmittedAt: timestamp('factoring_submitted_at', { withTimezone: true }),
    pdfDocumentId: uuid('pdf_document_id').references(() => documents.id, { onDelete: 'set null' }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    notes: text('notes'),
    ...auditable,
    ...retention,
  },
  (t) => [
    uniqueIndex('carrier_settlements_tenant_number_uq').on(t.tenantId, t.settlementNumber),
    index('carrier_settlements_tenant_idx').on(t.tenantId),
    index('carrier_settlements_carrier_idx').on(t.tenantId, t.carrierId, t.periodEnd),
  ],
)

export const carrierSettlementLines = pgTable(
  'carrier_settlement_lines',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    settlementId: uuid('settlement_id')
      .notNull()
      .references(() => carrierSettlements.id, { onDelete: 'cascade' }),
    loadId: uuid('load_id').references(() => loads.id),
    financialSnapshotId: uuid('financial_snapshot_id').references(() => financialSnapshots.id),
    descriptionEn: varchar('description_en', { length: 255 }).notNull(),
    descriptionEs: varchar('description_es', { length: 255 }),
    grossRateCents: cents('gross_rate_cents').notNull().default(0),
    reimbursementsCents: cents('reimbursements_cents').notNull().default(0),
    dispatchFeeCents: cents('dispatch_fee_cents').notNull().default(0),
    deductionsCents: cents('deductions_cents').notNull().default(0),
    netCents: cents('net_cents').notNull().default(0),
    ...auditable,
  },
  (t) => [
    index('carrier_settlement_lines_tenant_idx').on(t.tenantId),
    index('carrier_settlement_lines_settlement_idx').on(t.settlementId),
  ],
)

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  carrier: one(carriers, { fields: [invoices.carrierId], references: [carriers.id] }),
  load: one(loads, { fields: [invoices.loadId], references: [loads.id] }),
  lineItems: many(invoiceLineItems),
  payments: many(payments),
}))

export const financialSnapshotsRelations = relations(financialSnapshots, ({ one }) => ({
  load: one(loads, { fields: [financialSnapshots.loadId], references: [loads.id] }),
}))

export type Expense = typeof expenses.$inferSelect
export type ExpenseCategory = typeof expenseCategories.$inferSelect
export type FinancialSnapshot = typeof financialSnapshots.$inferSelect
export type NewFinancialSnapshot = typeof financialSnapshots.$inferInsert
export type DispatcherCommission = typeof dispatcherCommissions.$inferSelect
export type Invoice = typeof invoices.$inferSelect
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect
export type Payment = typeof payments.$inferSelect
export type PaymentAttempt = typeof paymentAttempts.$inferSelect
export type StripeEvent = typeof stripeEvents.$inferSelect
export type CarrierSettlement = typeof carrierSettlements.$inferSelect
