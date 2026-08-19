'use server'

import { z } from 'zod'
import { NextRequest } from 'next/server'
import { defineAction } from '@/server/action'
import { tenantDb } from '@/db/tenant-db'
import { invoices, tenantBranding } from '@/db/schema'
import { invoiceStatusEnum, paymentMethodEnum } from '@/db/schema/_shared'
import { getTenant, getTenantPolicy } from '@/server/context'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { getStorage } from '@/lib/storage'
import { emitMockEvent, getPaymentProvider } from '@/integrations/payments'
import { AppError } from '@/lib/errors'
import { can, scopeFilter, type Actor, type ResourceContext } from '@/lib/permissions'
import { moneyCentsSchema, reasonSchema, uuidSchema } from '@/lib/validation'
import { listLoads } from '@/server/loads/queries'
import {
  createDraftInvoiceForLoad,
  markOverdueInvoices,
  recordManualPayment,
  refundPayment,
  sendInvoice,
  startStripePayment,
  transitionInvoiceStatus,
} from './service'

function tenantContext(ctx: { actor: Actor }): { tenantId: string | null } {
  return { tenantId: ctx.actor.tenantId }
}

async function invoiceResource(input: { invoiceId: string }, ctx: { actor: Actor }): Promise<ResourceContext> {
  const base = tenantContext(ctx)
  if (!ctx.actor.tenantId) return base
  const invoice = await tenantDb(ctx.actor.tenantId).findById(invoices, input.invoiceId)
  return { ...base, carrierId: invoice?.carrierId ?? null }
}

/* ── Create / regenerate ──────────────────────────────────────────────────── */

const loadIdInput = z.object({ loadId: uuidSchema })

export const createInvoiceForLoadAction = defineAction({
  name: 'invoice.createForLoad',
  permission: 'invoice:create',
  input: loadIdInput,
  handler: (input, ctx) => createDraftInvoiceForLoad(ctx.db, input.loadId),
  audit: (input, output) => ({
    action: 'invoice.created',
    entityType: 'invoice',
    entityId: output.id,
    entityLabel: output.invoiceNumber,
    metadata: { loadId: input.loadId },
  }),
})

/** Backs the load combobox on the "create invoice" dialog (`invoice:create`, tenant-wide). */
export const searchLoadsForInvoiceAction = defineAction({
  name: 'invoice.picker.searchLoads',
  permission: 'invoice:create',
  input: z.object({ query: z.string().trim().max(120).optional() }),
  handler: async (input, ctx) => {
    const policy = await getTenantPolicy(ctx.actor.tenantId)
    const decision = can(ctx.actor, 'invoice:create', undefined, policy)
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

/* ── Send ─────────────────────────────────────────────────────────────────── */

const invoiceIdInput = z.object({ invoiceId: uuidSchema })

export const sendInvoiceAction = defineAction({
  name: 'invoice.send',
  permission: 'invoice:send',
  input: invoiceIdInput,
  resource: (input, ctx) => invoiceResource(input, ctx),
  handler: async (input, ctx) => {
    const tenant = await getTenant(ctx.actor.tenantId)
    const branding = await ctx.db.findFirst(tenantBranding)

    let logoPngBytes: Uint8Array | undefined
    if (branding?.logoStorageKey) {
      try {
        const stored = await getStorage().get(branding.logoStorageKey)
        if (stored.contentType === 'image/png') logoPngBytes = stored.body
      } catch {
        // Branding is decorative; a missing/unreadable logo must never block sending.
      }
    }

    const dictionary = await getDictionary(ctx.actor.locale, ['finance', 'document', 'common'])
    const t = createTranslator(dictionary, ctx.actor.locale)

    const tenantAddressLines = [tenant?.legalName ?? tenant?.displayName ?? 'Goliath Dispatch']

    return sendInvoice(
      ctx.db,
      ctx.actor,
      input.invoiceId,
      {
        tenantName: tenant?.displayName ?? 'Goliath Dispatch',
        tenantAddressLines,
        timezone: tenant?.defaultTimezone ?? 'America/New_York',
        logoPngBytes,
      },
      ctx.actor.locale,
      t,
    )
  },
  audit: (_input, output) => ({
    action: 'invoice.sent',
    entityType: 'invoice',
    entityId: output.id,
    entityLabel: output.invoiceNumber,
  }),
})

/* ── Status lifecycle ────────────────────────────────────────────────────── */

const transitionInvoiceInput = z.object({
  invoiceId: uuidSchema,
  toStatus: z.enum(invoiceStatusEnum.enumValues),
  reason: reasonSchema.optional(),
})

export const transitionInvoiceStatusAction = defineAction({
  name: 'invoice.transitionStatus',
  permission: 'invoice:status:update',
  input: transitionInvoiceInput,
  resource: (input, ctx) => invoiceResource(input, ctx),
  handler: (input, ctx) => transitionInvoiceStatus(ctx.db, input),
  audit: (input, output) => ({
    action: 'invoice.status_changed',
    entityType: 'invoice',
    entityId: output.id,
    entityLabel: output.invoiceNumber,
    reason: input.reason ?? 'status changed',
    metadata: { toStatus: output.status },
  }),
})

/* ── Manual payment ───────────────────────────────────────────────────────── */

const recordManualPaymentInput = z.object({
  invoiceId: uuidSchema,
  amountCents: moneyCentsSchema.refine((value) => value > 0, { message: 'validation.positive' }),
  method: z.enum(paymentMethodEnum.enumValues),
  reference: z.string().trim().max(120).optional(),
  receivedAt: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
})

export const recordManualPaymentAction = defineAction({
  name: 'payment.recordManual',
  permission: 'payment:record',
  input: recordManualPaymentInput,
  resource: (input, ctx) => invoiceResource(input, ctx),
  handler: (input, ctx) =>
    recordManualPayment(ctx.db, ctx.actor, {
      invoiceId: input.invoiceId,
      amountCents: input.amountCents,
      method: input.method,
      reference: input.reference ?? null,
      receivedAt: input.receivedAt ?? null,
      notes: input.notes ?? null,
    }),
  audit: (input, output) => ({
    action: 'payment.recorded',
    entityType: 'invoice',
    entityId: output.invoice.id,
    entityLabel: output.invoice.invoiceNumber,
    metadata: { amountCents: input.amountCents, method: input.method, paymentId: output.payment.id },
  }),
})

/* ── Refund ───────────────────────────────────────────────────────────────── */

const refundPaymentInput = z.object({
  paymentId: uuidSchema,
  amountCents: moneyCentsSchema.optional(),
  reason: reasonSchema,
})

export const refundPaymentAction = defineAction({
  name: 'payment.refund',
  permission: 'payment:refund',
  input: refundPaymentInput,
  handler: (input, ctx) => refundPayment(ctx.db, input),
  audit: (input, output) => ({
    action: 'payment.refunded',
    entityType: 'payment',
    entityId: output.id,
    reason: input.reason,
    metadata: { refundedAmountCents: output.refundedAmountCents },
  }),
})

/* ── Carrier-initiated Stripe payment ────────────────────────────────────── */

const startStripePaymentInput = z.object({
  invoiceId: uuidSchema,
  method: z.enum(['card', 'ach']),
})

export const startStripePaymentAction = defineAction({
  name: 'invoice.startStripePayment',
  permission: 'invoice:pay',
  input: startStripePaymentInput,
  resource: (input, ctx) => invoiceResource(input, ctx),
  handler: (input, ctx) => startStripePayment(ctx.db, input),
})

/**
 * Drives the entire "Pay now" panel in a single round trip when running
 * against the mock payment provider: starts the PaymentIntent, then submits
 * a signed `payment_intent.succeeded` event through the SAME webhook route
 * production Stripe calls (`POST /api/webhooks/stripe`), so the invoice
 * lands in `paid` through the exact idempotent path the real integration
 * uses — nothing here takes a shortcut around `invoicePaymentEffects`.
 *
 * Refuses outright when `STRIPE_DRIVER=live` — a real card can only be
 * confirmed client-side with Stripe.js/Elements against the `clientSecret`
 * from `startStripePaymentAction`, which this repository does not ship a
 * client integration for. That is out of this module's scope; wiring an
 * actual Stripe Elements panel belongs to whoever owns the payment
 * front-end for a live deployment.
 */
export const payInvoiceWithMockCardAction = defineAction({
  name: 'invoice.payWithMockCard',
  permission: 'invoice:pay',
  input: invoiceIdInput,
  resource: (input, ctx) => invoiceResource(input, ctx),
  handler: async (input, ctx) => {
    if (getPaymentProvider().name !== 'payments.mock') {
      throw new AppError('validation_failed', 'finance.invoice.payment.mockOnlyError')
    }
    const { paymentIntentId, amountCents } = await startStripePayment(ctx.db, {
      invoiceId: input.invoiceId,
      method: 'card',
    })
    const { rawBody, signature } = emitMockEvent('payment_intent.succeeded', {
      id: paymentIntentId,
      amount: amountCents,
      currency: 'usd',
      metadata: { tenantId: ctx.actor.tenantId, invoiceId: input.invoiceId, kind: 'customer_invoice' },
    })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const response = await POST(
      new NextRequest('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
        body: rawBody,
      }),
    )
    if (!response.ok) {
      throw new AppError('validation_failed', 'finance.invoice.payment.attemptFailed', {
        params: { reason: `webhook responded ${response.status}` },
      })
    }
    const invoice = await ctx.db.requireById(invoices, input.invoiceId, 'invoice')
    return invoice
  },
  audit: (input, output) => ({
    action: 'payment.recorded',
    entityType: 'invoice',
    entityId: output.id,
    entityLabel: output.invoiceNumber,
    metadata: { amountCents: output.amountPaidCents, method: 'card', mock: true },
  }),
})

/* ── Daily overdue sweep ──────────────────────────────────────────────────── */

/**
 * Not gated behind a user-facing permission — this is the function the daily
 * background job calls (`src/jobs/**`, not yet built as of this writing; see
 * the finance agent's final report for wiring instructions). Exposed as a
 * plain async function rather than a `defineAction` because a scheduled job
 * has no authenticated Actor to check a permission against.
 */
export async function runMarkOverdueInvoicesJob(tenantId: string, asOf: Date = new Date()) {
  return markOverdueInvoices(tenantDb(tenantId), asOf)
}
