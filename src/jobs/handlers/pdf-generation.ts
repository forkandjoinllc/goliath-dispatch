import 'server-only'
import { z } from 'zod'
import { asc, eq } from 'drizzle-orm'
import { tenantDb, type TenantDb } from '@/db/tenant-db'
import { carriers, invoiceLineItems, invoices, documentVersions } from '@/db/schema'
import type { Actor } from '@/lib/permissions'
import { notFound } from '@/lib/errors'
import { getTenant } from '@/server/context'
import { addVersion } from '@/server/documents/service'
import { renderInvoicePdf } from '@/lib/pdf/invoice-pdf'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import type { Locale } from '@/i18n/config'
import { defineJob, type JobContext } from '../registry'

/**
 * Re-renders a PDF that already exists, storing the result as a new
 * `document_versions` row through the document service (never a raw storage
 * write) — for recovering from a storage hiccup after the invoice, or for a
 * future "regenerate PDF" admin action to enqueue against.
 *
 * Only `kind: 'invoice'` is implemented. Every one of `sendInvoice()`
 * (invoices), `issueSettlement()` (settlements) and
 * `generateAndAttachCertificate()` (signatures) already renders and stores
 * its PDF synchronously and correctly today — this job is not in either of
 * those paths. Extending it to settlements/audit-certificates would mean
 * duplicating private, non-exported data-gathering helpers those modules
 * deliberately keep internal (this agent does not own or refactor their
 * modules); `kind: 'signed_agreement'` is refused outright, not merely
 * unimplemented — a signed document's bytes are sealed by
 * `signatureRecords.integritySeal` over its exact hash, and silently
 * re-rendering it would produce bytes that no longer match that seal.
 */

const payloadSchema = z.object({
  kind: z.enum(['invoice', 'settlement', 'signed_agreement', 'audit_certificate']),
  entityId: z.string().uuid(),
})

function carrierAddressLines(carrier: { physicalLine1: string | null; physicalLine2: string | null; physicalCity: string | null; physicalState: string | null; physicalPostalCode: string | null }): string[] {
  const lines: string[] = []
  if (carrier.physicalLine1) lines.push(carrier.physicalLine1)
  if (carrier.physicalLine2) lines.push(carrier.physicalLine2)
  const cityState = [carrier.physicalCity, carrier.physicalState].filter(Boolean).join(', ')
  const cityStateZip = [cityState, carrier.physicalPostalCode].filter(Boolean).join(' ')
  if (cityStateZip) lines.push(cityStateZip)
  return lines
}

async function regenerateInvoicePdf(db: TenantDb, invoiceId: string): Promise<void> {
  const invoice = await db.requireById(invoices, invoiceId, 'invoice')
  if (!invoice.pdfDocumentId) {
    // Nothing to regenerate — the invoice has never been sent, so there is
    // no prior PDF to replace. Not retryable; the caller should send the
    // invoice first.
    throw notFound('finance.errors.invoiceNotFound')
  }

  const currentVersion = invoice.pdfDocumentId
    ? await db.findFirst(documentVersions, { where: eq(documentVersions.documentId, invoice.pdfDocumentId) })
    : null
  const attributedToUserId = currentVersion?.uploadedByUserId
  if (!attributedToUserId) {
    throw notFound('finance.errors.invoiceNotFound')
  }

  const carrier = await db.requireById(carriers, invoice.carrierId, 'carrier')
  const lineItems = await db.findMany(invoiceLineItems, {
    where: eq(invoiceLineItems.invoiceId, invoice.id),
    orderBy: asc(invoiceLineItems.sequence),
  })
  const tenant = await getTenant(db.tenantId)
  const locale: Locale = 'en'
  const dictionary = await getDictionary(locale, ['document', 'common'])
  const t = createTranslator(dictionary, locale)

  const pdfBytes = await renderInvoicePdf(
    {
      tenantName: tenant?.displayName ?? 'Goliath Dispatch',
      tenantAddressLines: [],
      timezone: tenant?.defaultTimezone ?? 'America/New_York',
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      paymentTermsDays: invoice.paymentTermsDays,
      billTo: { name: carrier.legalName, addressLines: carrierAddressLines(carrier) },
      lineItems: lineItems.map((item) => ({
        description: item.descriptionEn,
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

  // `addVersion` needs a full `Actor` shape but only ever persists
  // `.userId` (`uploadedByUserId`) — attributing the regenerated version to
  // whoever produced the original one keeps that foreign key pointed at a
  // real user row rather than a fabricated one.
  const systemActor = { userId: attributedToUserId } as Actor

  await addVersion(db, systemActor, {
    documentId: invoice.pdfDocumentId,
    originalFilename: `${invoice.invoiceNumber}.pdf`,
    bytes: Buffer.from(pdfBytes),
  })
}

export async function regeneratePdf(payload: z.infer<typeof payloadSchema>, ctx: JobContext): Promise<void> {
  if (!ctx.tenantId) throw new Error('pdf.generate requires a tenantId')
  const db = tenantDb(ctx.tenantId)

  switch (payload.kind) {
    case 'invoice':
      return regenerateInvoicePdf(db, payload.entityId)
    case 'signed_agreement':
      throw new Error('pdf.generate refuses to regenerate a signed agreement: it would invalidate the integrity seal')
    case 'settlement':
    case 'audit_certificate':
      throw new Error(`pdf.generate does not yet support kind "${payload.kind}" — see this file's header comment`)
  }
}

defineJob('pdf.generate', {
  schema: payloadSchema,
  handler: regeneratePdf,
  defaultMaxAttempts: 3,
  description: 'Re-renders and re-stores an invoice PDF as a new document version.',
})
