import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { tenantDb } from '@/db/tenant-db'
import {
  carriers,
  invoiceLineItems,
  invoices,
  loads,
  paymentAttempts,
  payments,
  tenantSettings,
  type Carrier,
  type Invoice,
  type InvoiceLineItem,
  type Payment,
  type PaymentAttempt,
} from '@/db/schema'
import type { invoiceStatusEnum, paymentMethodEnum } from '@/db/schema/_shared'
import { centsToDollars, sum } from '@/lib/money'
import { AppError, conflict, notFound, validationFailed } from '@/lib/errors'
import type { Actor } from '@/lib/permissions'
import type { Locale } from '@/i18n/config'
import type { TranslateFn } from '@/i18n/translate'
import { getEmailProvider, renderEmailShell } from '@/integrations/email'
import { getPaymentProvider as getPaymentProviderDirect } from '@/integrations/payments'
import { renderInvoicePdf } from '@/lib/pdf/invoice-pdf'
import { newId } from '@/lib/crypto'
import { uploadDocument } from '@/server/documents/service'
import {
  registerInvoicePaymentEffects,
  type CarrierInvoicePaymentEvent,
  type InvoicePaymentEffects,
} from '@/server/tenants/payment-effects'
import { listExpensesForLoad } from '@/server/finance/expenses'
import { latestSnapshot, onFinancialInputChanged } from '@/server/finance/snapshots'
import { nextInvoiceNumber } from './numbering'
import { listOverdueCandidates } from './queries'

type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number]
type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number]

/**
 * The carrier-invoicing domain: draft creation off `pod_received`, sending
 * (PDF + email), the status lifecycle, manual and Stripe payments, refunds,
 * and the daily overdue sweep.
 */

/* ── Draft creation ───────────────────────────────────────────────────────── */

/**
 * Called automatically when a load reaches `pod_received` — the loads
 * module's status-transition code should call this (see the finance agent's
 * final report for the exact hook name/signature). Idempotent: a second call
 * for the same load returns the existing invoice rather than creating a
 * duplicate, so a retried job or a duplicate status-history write is safe.
 */
export async function createDraftInvoiceForLoad(db: TenantDb, loadId: string): Promise<Invoice> {
  return db.transaction(async (tx) => {
    const load = await tx.requireById(loads, loadId, 'load')
    if (!load.carrierId) {
      throw validationFailed('finance.validation.loadMissingCarrier')
    }

    const existing = await tx.findFirst(invoices, { where: eq(invoices.loadId, loadId) })
    if (existing) return existing

    let snapshot = await latestSnapshot(tx, loadId)
    if (!snapshot) {
      const result = await onFinancialInputChanged(tx, loadId, {
        reason: 'invoice_draft_created',
        actorUserId: null,
      })
      snapshot = result.snapshot
    }

    const loadExpenses = await listExpensesForLoad(tx, loadId)
    const deductionExpenses = loadExpenses.filter(
      (expense) =>
        (expense.status === 'approved' || expense.status === 'reimbursed') &&
        expense.treatmentSnapshot === 'carrier_deduction',
    )

    const settings = await tx.findFirst(tenantSettings)
    const paymentTermsDays = settings?.defaultPaymentTermsDays ?? 30
    const dueDate = new Date()
    dueDate.setUTCDate(dueDate.getUTCDate() + paymentTermsDays)

    const invoiceNumber = await nextInvoiceNumber(tx)

    interface DraftLine {
      descriptionEn: string
      descriptionEs: string
      amountCents: number
      kind: string
    }
    const draftLines: DraftLine[] = [
      {
        descriptionEn: `Dispatch fee — load ${load.loadNumber}`,
        descriptionEs: `Cuota de despacho — carga ${load.loadNumber}`,
        amountCents: snapshot.dispatchFeeAmountCents,
        kind: 'dispatch_fee',
      },
      ...deductionExpenses.map((expense) => ({
        descriptionEn: expense.description ?? `Deduction — load ${load.loadNumber}`,
        descriptionEs: expense.description ?? `Deducción — carga ${load.loadNumber}`,
        amountCents: expense.amountCents,
        kind: 'expense',
      })),
    ]

    const subtotalCents = sum(...draftLines.map((line) => line.amountCents))

    const invoice = await tx.insert(invoices, {
      invoiceNumber,
      carrierId: load.carrierId,
      loadId,
      status: 'draft',
      subtotalCents,
      adjustmentsCents: 0,
      totalCents: subtotalCents,
      amountPaidCents: 0,
      balanceCents: subtotalCents,
      dueDate,
      paymentTermsDays,
    })

    await tx.insertMany(
      invoiceLineItems,
      draftLines.map((line, index) => ({
        invoiceId: invoice.id,
        loadId,
        sequence: index,
        descriptionEn: line.descriptionEn,
        descriptionEs: line.descriptionEs,
        quantity: 1,
        unitAmountCents: line.amountCents,
        amountCents: line.amountCents,
        kind: line.kind,
      })),
    )

    return invoice
  })
}

/* ── Send ─────────────────────────────────────────────────────────────────── */

export interface SendInvoiceBrandContext {
  tenantName: string
  tenantAddressLines: string[]
  timezone: string
  logoPngBytes?: Uint8Array | null
  contactEmail?: string | null
  contactPhone?: string | null
}

export async function sendInvoice(
  db: TenantDb,
  actor: Actor,
  invoiceId: string,
  brand: SendInvoiceBrandContext,
  locale: Locale,
  t: TranslateFn,
): Promise<Invoice> {
  return db.transaction(async (tx) => {
    const invoice = await tx.requireById(invoices, invoiceId, 'invoice')
    if (invoice.status !== 'draft' && invoice.status !== 'sent') {
      throw conflict('finance.errors.invalidInvoiceTransition', { from: invoice.status, to: 'sent' })
    }

    const carrier = await tx.requireById(carriers, invoice.carrierId, 'carrier')
    const lineItems = await tx.findMany(invoiceLineItems, {
      where: eq(invoiceLineItems.invoiceId, invoice.id),
      orderBy: asc(invoiceLineItems.sequence),
    })

    const issueDate = invoice.issueDate ?? new Date()

    const pdfBytes = await renderInvoicePdf(
      {
        tenantName: brand.tenantName,
        tenantAddressLines: brand.tenantAddressLines,
        logoPngBytes: brand.logoPngBytes,
        timezone: brand.timezone,
        invoiceNumber: invoice.invoiceNumber,
        issueDate,
        dueDate: invoice.dueDate,
        paymentTermsDays: invoice.paymentTermsDays,
        billTo: { name: carrier.legalName, addressLines: carrierAddressLines(carrier) },
        lineItems: lineItems.map((item) => ({
          description: (locale === 'es' ? item.descriptionEs : item.descriptionEn) ?? item.descriptionEn,
          quantity: item.quantity,
          unitAmountCents: item.unitAmountCents,
          amountCents: item.amountCents,
        })),
        subtotalCents: invoice.subtotalCents,
        adjustmentsCents: invoice.adjustmentsCents,
        totalCents: invoice.totalCents,
        amountPaidCents: invoice.amountPaidCents,
        balanceCents: invoice.balanceCents,
        notes: invoice.notes,
      },
      locale,
      t,
    )

    const { document } = await uploadDocument(tx, actor, {
      ownerType: 'invoice',
      ownerId: invoice.id,
      documentType: 'invoice',
      originalFilename: `${invoice.invoiceNumber}.pdf`,
      bytes: Buffer.from(pdfBytes),
    })

    const updated = await tx.update(invoices, invoice.id, {
      status: 'sent',
      issueDate,
      sentAt: new Date(),
      pdfDocumentId: document.id,
    })
    if (!updated) throw notFound('finance.errors.invoiceNotFound')

    const introText = t('finance.email.invoiceBody', { invoiceNumber: invoice.invoiceNumber, tenant: brand.tenantName })
    const shell = renderEmailShell({
      locale,
      branding: {
        tenantDisplayName: brand.tenantName,
        contactEmail: brand.contactEmail ?? undefined,
        contactPhone: brand.contactPhone ?? undefined,
      },
      bodyHtml: `<p>${escapeHtml(introText)}</p>`,
      bodyText: introText,
    })

    await getEmailProvider().send({
      to: carrier.email,
      subject: t('finance.email.invoiceSubject', { invoiceNumber: invoice.invoiceNumber, tenant: brand.tenantName }),
      html: shell.html,
      text: shell.text,
      tags: ['invoice'],
      attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, contentType: 'application/pdf', content: pdfBytes }],
    })

    return updated
  })
}

function carrierAddressLines(carrier: Carrier): string[] {
  const lines: string[] = []
  if (carrier.physicalLine1) lines.push(carrier.physicalLine1)
  if (carrier.physicalLine2) lines.push(carrier.physicalLine2)
  const cityStateZip = [carrier.physicalCity, carrier.physicalState].filter(Boolean).join(', ')
  const cityStateZipFull = [cityStateZip, carrier.physicalPostalCode].filter(Boolean).join(' ')
  if (cityStateZipFull) lines.push(cityStateZipFull)
  return lines
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/* ── Status lifecycle ────────────────────────────────────────────────────── */

const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['sent', 'voided'],
  sent: ['due', 'paid', 'disputed', 'voided', 'uncollectable'],
  due: ['paid', 'overdue', 'disputed', 'voided', 'uncollectable'],
  overdue: ['paid', 'disputed', 'voided', 'uncollectable'],
  disputed: ['due', 'paid', 'voided', 'uncollectable'],
  paid: [],
  voided: [],
  uncollectable: ['paid'],
}

const REASON_REQUIRED_STATUSES = new Set<InvoiceStatus>(['voided', 'disputed', 'uncollectable'])

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return (INVOICE_TRANSITIONS[from] ?? []).includes(to)
}

export interface TransitionInvoiceInput {
  invoiceId: string
  toStatus: InvoiceStatus
  reason?: string
}

/** A paid invoice is terminal — `INVOICE_TRANSITIONS.paid` is empty, so this always rejects further transitions. */
export async function transitionInvoiceStatus(
  db: TenantDb,
  input: TransitionInvoiceInput,
): Promise<Invoice> {
  return db.transaction(async (tx) => {
    const invoice = await tx.requireById(invoices, input.invoiceId, 'invoice')

    if (!canTransitionInvoice(invoice.status, input.toStatus)) {
      throw conflict('finance.errors.invalidInvoiceTransition', { from: invoice.status, to: input.toStatus })
    }
    if (REASON_REQUIRED_STATUSES.has(input.toStatus) && !input.reason?.trim()) {
      throw validationFailed('finance.validation.reasonRequired')
    }

    const patch: Partial<typeof invoices.$inferInsert> = { status: input.toStatus }
    if (input.toStatus === 'voided') {
      patch.voidedAt = new Date()
      patch.voidReason = input.reason ?? null
    }
    if (input.toStatus === 'disputed') {
      patch.disputedAt = new Date()
      patch.disputeReason = input.reason ?? null
    }
    if (input.toStatus === 'uncollectable') {
      patch.uncollectableAt = new Date()
    }
    if (input.toStatus === 'paid') {
      patch.paidAt = new Date()
    }

    const updated = await tx.update(invoices, invoice.id, patch)
    if (!updated) throw notFound('finance.errors.invoiceNotFound')
    return updated
  })
}

/* ── Manual payments ──────────────────────────────────────────────────────── */

export interface RecordManualPaymentInput {
  invoiceId: string
  amountCents: number
  method: PaymentMethod
  reference?: string | null
  receivedAt?: Date | null
  notes?: string | null
}

export interface PaymentApplicationInputInvoice {
  totalCents: number
  amountPaidCents: number
  balanceCents: number
  status: InvoiceStatus
}

export interface PaymentApplicationResult {
  amountPaidCents: number
  balanceCents: number
  status: InvoiceStatus
}

/**
 * The pure arithmetic behind a partial/full payment, factored out so it is
 * unit-testable without a database. Never lets the balance go negative — an
 * amount greater than the current balance is a validation error naming the
 * maximum acceptable amount. The invoice moves to `paid` only once the
 * running balance reaches exactly zero; anything less keeps it `sent` (a
 * `draft` invoice that somehow received a payment is nudged to `sent` too,
 * since a payment implies it must have been presented to the carrier).
 */
export function applyPaymentToInvoice(
  invoice: PaymentApplicationInputInvoice,
  amountCents: number,
): PaymentApplicationResult {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw validationFailed('finance.validation.amountPositive')
  }
  if (amountCents > invoice.balanceCents) {
    // `validationFailed()`'s second argument is server-only `detail`, never
    // shown to the client — the maximum has to be a client-visible `params`
    // value, so this constructs the AppError directly instead.
    throw new AppError('validation_failed', 'finance.validation.overpayment', {
      params: { maxAmount: centsToDollars(invoice.balanceCents).toFixed(2) },
    })
  }

  const amountPaidCents = invoice.amountPaidCents + amountCents
  const balanceCents = invoice.totalCents - amountPaidCents
  const status: InvoiceStatus = balanceCents <= 0 ? 'paid' : invoice.status === 'draft' ? 'sent' : invoice.status

  return { amountPaidCents, balanceCents: Math.max(balanceCents, 0), status }
}

/**
 * Records a manual (check/wire/cash/offset/other) payment. Supports partial
 * payment via `applyPaymentToInvoice` above.
 */
export async function recordManualPayment(
  db: TenantDb,
  actor: Actor,
  input: RecordManualPaymentInput,
): Promise<{ invoice: Invoice; payment: Payment }> {
  return db.transaction(async (tx) => {
    const invoice = await tx.requireById(invoices, input.invoiceId, 'invoice')
    if (invoice.status === 'paid' || invoice.status === 'voided') {
      throw conflict('finance.errors.invoiceNotPayable', { status: invoice.status })
    }

    const application = applyPaymentToInvoice(invoice, input.amountCents)

    const payment = await tx.insert(payments, {
      invoiceId: invoice.id,
      amountCents: input.amountCents,
      method: input.method,
      status: 'succeeded',
      reference: input.reference ?? null,
      receivedAt: input.receivedAt ?? new Date(),
      recordedByUserId: actor.userId,
      notes: input.notes ?? null,
    })

    const updated = await tx.update(invoices, invoice.id, {
      amountPaidCents: application.amountPaidCents,
      balanceCents: application.balanceCents,
      status: application.status,
      paidAt: application.status === 'paid' ? new Date() : invoice.paidAt,
    })
    if (!updated) throw notFound('finance.errors.invoiceNotFound')

    return { invoice: updated, payment }
  })
}

/* ── Stripe payment (carrier-initiated) ──────────────────────────────────── */

export interface StartStripePaymentInput {
  invoiceId: string
  method: 'card' | 'ach'
}

export interface StartStripePaymentResult {
  clientSecret: string | null
  paymentIntentId: string
  amountCents: number
}

export async function startStripePayment(
  db: TenantDb,
  input: StartStripePaymentInput,
): Promise<StartStripePaymentResult> {
  return db.transaction(async (tx) => {
    const invoice = await tx.requireById(invoices, input.invoiceId, 'invoice')
    if (invoice.status === 'paid' || invoice.status === 'voided' || invoice.status === 'uncollectable') {
      throw conflict('finance.errors.invoiceNotPayable', { status: invoice.status })
    }
    if (invoice.balanceCents <= 0) {
      throw conflict('finance.errors.invoiceAlreadyPaid')
    }

    const idempotencyKey = `invoice:${invoice.id}:${input.method}:${newId()}`

    const intent = await getPaymentProviderDirect().createPaymentIntent({
      amountCents: invoice.balanceCents,
      currency: 'usd',
      description: `Invoice ${invoice.invoiceNumber}`,
      paymentMethodTypes: input.method === 'ach' ? ['card', 'us_bank_account'] : ['card'],
      metadata: { tenantId: tx.tenantId, invoiceId: invoice.id, kind: 'customer_invoice' },
      idempotencyKey,
    })

    await tx.insert(paymentAttempts, {
      invoiceId: invoice.id,
      method: input.method,
      amountCents: invoice.balanceCents,
      status: 'pending',
      idempotencyKey,
      providerReference: intent.paymentIntentId,
    })

    await tx.update(invoices, invoice.id, { stripePaymentIntentId: intent.paymentIntentId })

    return {
      clientSecret: intent.clientSecret,
      paymentIntentId: intent.paymentIntentId,
      amountCents: invoice.balanceCents,
    }
  })
}

/* ── Stripe effects (webhook contract implementation) ────────────────────── */

/**
 * Implements `InvoicePaymentEffects` from `src/server/tenants/payment-effects.ts`.
 * `applyStripeEffect` is the single function the webhook route reaches via
 * that registration; each handler below is idempotent independent of the
 * webhook route's own `stripe_events` dedupe:
 *   - `recordPaymentSucceeded` relies on the unique index on
 *     `payments.stripe_payment_intent_id` — a second delivery for the same
 *     PaymentIntent finds the existing payment row and does nothing.
 *   - `recordPaymentFailed`/`recordRefund`/`recordDispute` look up state by
 *     payment intent id and check whether the effect already applied before
 *     writing anything.
 */
export const invoicePaymentEffects: InvoicePaymentEffects = {
  async recordPaymentSucceeded(event: CarrierInvoicePaymentEvent) {
    if (!event.paymentIntentId) return
    const db = tenantDb(event.tenantId)
    await db.transaction(async (tx) => {
      const invoice = await tx.findById(invoices, event.invoiceId)
      if (!invoice) return

      const alreadyApplied = await tx.findFirst(payments, {
        where: eq(payments.stripePaymentIntentId, event.paymentIntentId!),
      })
      if (alreadyApplied) return
      if (invoice.status === 'paid') return

      const amountCents = Math.min(event.amountCents, invoice.balanceCents)
      const payment = await tx.insert(payments, {
        invoiceId: invoice.id,
        amountCents,
        method: 'card',
        status: 'succeeded',
        stripePaymentIntentId: event.paymentIntentId,
        stripeChargeId: event.chargeId,
        receivedAt: event.occurredAt,
      })

      await tx.updateWhere(
        paymentAttempts,
        and(
          eq(paymentAttempts.invoiceId, invoice.id),
          eq(paymentAttempts.providerReference, event.paymentIntentId!),
        )!,
        { status: 'succeeded', paymentId: payment.id },
      )

      const amountPaidCents = invoice.amountPaidCents + amountCents
      const balanceCents = Math.max(invoice.totalCents - amountPaidCents, 0)
      await tx.update(invoices, invoice.id, {
        amountPaidCents,
        balanceCents,
        status: balanceCents <= 0 ? 'paid' : invoice.status === 'draft' ? 'sent' : invoice.status,
        paidAt: balanceCents <= 0 ? new Date() : invoice.paidAt,
      })
    })
  },

  async recordPaymentFailed(event) {
    if (!event.paymentIntentId) return
    const db = tenantDb(event.tenantId)
    await db.updateWhere(
      paymentAttempts,
      and(
        eq(paymentAttempts.invoiceId, event.invoiceId),
        eq(paymentAttempts.providerReference, event.paymentIntentId),
      )!,
      { status: 'failed', failureMessage: event.failureReason ?? null },
    )
  },

  async recordRefund(event) {
    if (!event.paymentIntentId) return
    const db = tenantDb(event.tenantId)
    await db.transaction(async (tx) => {
      const payment = await tx.findFirst(payments, {
        where: eq(payments.stripePaymentIntentId, event.paymentIntentId!),
      })
      if (!payment) return
      if (payment.refundedAmountCents >= payment.amountCents) return // already fully refunded

      const additionalRefundCents = Math.min(
        payment.amountCents - payment.refundedAmountCents,
        event.amountCents > 0 ? event.amountCents : payment.amountCents,
      )
      const refundedAmountCents = payment.refundedAmountCents + additionalRefundCents

      await tx.update(payments, payment.id, {
        refundedAmountCents,
        refundedAt: event.occurredAt,
        status: refundedAmountCents >= payment.amountCents ? 'refunded' : 'partially_refunded',
      })

      const invoice = await tx.requireById(invoices, payment.invoiceId, 'invoice')
      const amountPaidCents = Math.max(invoice.amountPaidCents - additionalRefundCents, 0)
      const balanceCents = invoice.totalCents - amountPaidCents
      await tx.update(invoices, invoice.id, {
        amountPaidCents,
        balanceCents,
        status: balanceCents > 0 && invoice.status === 'paid' ? 'due' : invoice.status,
      })
    })
  },

  async recordDispute(event) {
    const db = tenantDb(event.tenantId)
    await db.transaction(async (tx) => {
      if (event.paymentIntentId) {
        const payment = await tx.findFirst(payments, {
          where: eq(payments.stripePaymentIntentId, event.paymentIntentId),
        })
        if (payment && !payment.disputedAt) {
          await tx.update(payments, payment.id, {
            disputedAt: event.occurredAt,
            disputeReason: 'stripe_dispute_created',
            status: 'disputed',
          })
        }
      }
      const invoice = await tx.findById(invoices, event.invoiceId)
      if (invoice && invoice.status !== 'disputed') {
        await tx.update(invoices, invoice.id, {
          status: 'disputed',
          disputedAt: event.occurredAt,
          disputeReason: 'Stripe chargeback/dispute created',
        })
      }
    })
  },
}

// Module-level registration: whatever process warms this module (any page or
// action under `src/app/**/app/invoices/**`, or an app-startup hook such as
// `instrumentation.ts` if one is added) makes the webhook route's payment
// events routable. See `payment-effects.ts` — until this has run at least
// once, matching events are stored `received` and can be replayed later, so
// nothing is lost, only delayed.
registerInvoicePaymentEffects(invoicePaymentEffects)

/* ── Refunds ──────────────────────────────────────────────────────────────── */

export interface RefundPaymentInput {
  paymentId: string
  amountCents?: number
  reason: string
}

export async function refundPayment(db: TenantDb, input: RefundPaymentInput): Promise<Payment> {
  if (!input.reason?.trim()) {
    throw validationFailed('finance.validation.reasonRequired')
  }

  return db.transaction(async (tx) => {
    const payment = await tx.requireById(payments, input.paymentId, 'payment')
    const refundableCents = payment.amountCents - payment.refundedAmountCents
    if (refundableCents <= 0) {
      throw conflict('finance.errors.paymentAlreadyRefunded')
    }
    const amountCents = input.amountCents ?? refundableCents
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > refundableCents) {
      throw new AppError('validation_failed', 'finance.validation.refundExceedsAvailable', {
        params: { maxAmount: centsToDollars(refundableCents).toFixed(2) },
      })
    }

    if (payment.stripePaymentIntentId) {
      await getPaymentProviderDirect().createRefund({
        paymentIntentId: payment.stripePaymentIntentId,
        amountCents,
        reason: 'requested_by_customer',
        idempotencyKey: `refund:${payment.id}:${amountCents}`,
      })
    }

    const refundedAmountCents = payment.refundedAmountCents + amountCents
    const updatedPayment = await tx.update(payments, payment.id, {
      refundedAmountCents,
      refundedAt: new Date(),
      status: refundedAmountCents >= payment.amountCents ? 'refunded' : 'partially_refunded',
      notes: payment.notes ? `${payment.notes}\n${input.reason}` : input.reason,
    })
    if (!updatedPayment) throw notFound('finance.errors.paymentNotFound')

    const invoice = await tx.requireById(invoices, payment.invoiceId, 'invoice')
    const amountPaidCents = Math.max(invoice.amountPaidCents - amountCents, 0)
    const balanceCents = invoice.totalCents - amountPaidCents
    await tx.update(invoices, invoice.id, {
      amountPaidCents,
      balanceCents,
      status: balanceCents > 0 && invoice.status === 'paid' ? 'due' : invoice.status,
    })

    return updatedPayment
  })
}

/* ── Daily overdue sweep ──────────────────────────────────────────────────── */

/** The query + transition the daily job calls. Idempotent: already-overdue invoices are simply skipped. */
export async function markOverdueInvoices(db: TenantDb, asOf: Date = new Date()): Promise<Invoice[]> {
  const candidates = await listOverdueCandidates(db, asOf)
  const updated: Invoice[] = []
  for (const invoice of candidates) {
    const next = await db.update(invoices, invoice.id, { status: 'overdue' })
    if (next) updated.push(next)
  }
  return updated
}

export type { Invoice, InvoiceLineItem, Payment, PaymentAttempt }
