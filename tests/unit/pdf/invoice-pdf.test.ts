import zlib from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { renderInvoicePdf, type InvoicePdfData } from '@/lib/pdf/invoice-pdf'
import { renderSettlementPdf, type SettlementPdfData } from '@/lib/pdf/settlement-pdf'

async function translator(locale: 'en' | 'es' = 'en') {
  const dictionary = await getDictionary(locale)
  return createTranslator(dictionary, locale)
}

/**
 * pdf-lib always Flate-encodes page content streams, so the text we drew
 * never appears literally in the raw file bytes. This walks every
 * `stream…endstream` block and inflates it (falling back to the raw bytes for
 * blocks that were never compressed, e.g. cross-reference/object streams
 * already excluded by the caller) so a test can assert on drawn text.
 */
function decodeAllStreams(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes)
  const raw = buffer.toString('latin1')
  const decoded: string[] = []
  const streamMarker = /stream\r?\n/g
  let match: RegExpExecArray | null
   
  while ((match = streamMarker.exec(raw))) {
    const start = match.index + match[0].length
    const end = raw.indexOf('endstream', start)
    if (end === -1) break
    let trimmedEnd = end
    if (raw[trimmedEnd - 1] === '\n') trimmedEnd -= 1
    if (raw[trimmedEnd - 1] === '\r') trimmedEnd -= 1
    const chunk = buffer.subarray(start, trimmedEnd)
    try {
      decoded.push(zlib.inflateSync(chunk).toString('latin1'))
    } catch {
      decoded.push(chunk.toString('latin1'))
    }
  }
  return decodeHexStringLiterals(decoded.join('\n'))
}

/** pdf-lib sometimes emits a text-showing operand as a hex string (`<...>`) rather than a literal `(...)` string; normalize both to plain text before searching. */
function decodeHexStringLiterals(text: string): string {
  return text.replace(/<([0-9A-Fa-f]+)>/g, (match, hex: string) => {
    if (hex.length % 2 !== 0) return match
    try {
      return Buffer.from(hex, 'hex').toString('latin1')
    } catch {
      return match
    }
  })
}

function sampleInvoice(overrides: Partial<InvoicePdfData> = {}): InvoicePdfData {
  return {
    tenantName: 'Goliath Dispatch Demo',
    tenantAddressLines: ['123 Freight Way', 'Dallas, TX 75201'],
    logoPngBytes: null,
    timezone: 'America/Chicago',
    invoiceNumber: 'INV-1042',
    issueDate: new Date('2026-01-01T00:00:00Z'),
    dueDate: new Date('2026-01-31T00:00:00Z'),
    paymentTermsDays: 30,
    billTo: { name: 'Acme Trucking LLC', addressLines: ['456 Haul Rd', 'Fort Worth, TX 76102'] },
    lineItems: [
      { description: 'Dispatch fee — Load GD-1001', quantity: 1, unitAmountCents: 25000, amountCents: 25000 },
      { description: 'Dispatch fee — Load GD-1002', quantity: 1, unitAmountCents: 18000, amountCents: 18000 },
    ],
    subtotalCents: 43000,
    adjustmentsCents: 0,
    totalCents: 43000,
    amountPaidCents: 0,
    balanceCents: 43000,
    notes: 'Thank you for your business.',
    ...overrides,
  }
}

describe('renderInvoicePdf', () => {
  it('renders a valid, non-empty PDF', async () => {
    const t = await translator('en')
    const bytes = await renderInvoicePdf(sampleInvoice(), 'en', t)

    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe('%PDF')
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThan(0)
  })

  it('embeds the invoice number as visible text on the page', async () => {
    const t = await translator('en')
    const bytes = await renderInvoicePdf(sampleInvoice({ invoiceNumber: 'INV-9999' }), 'en', t)

    // pdf-lib does not expose a text-extraction API; decoding the (Flate
    // compressed) content stream is enough to prove the value made it into
    // the document rather than being silently dropped.
    expect(decodeAllStreams(bytes)).toContain('INV-9999')
  })

  it('paginates a very long line-item table across multiple pages', async () => {
    const t = await translator('en')
    const manyLines = Array.from({ length: 60 }, (_, i) => ({
      description: `Dispatch fee — Load GD-${1000 + i}`,
      quantity: 1,
      unitAmountCents: 10000,
      amountCents: 10000,
    }))
    const bytes = await renderInvoicePdf(
      sampleInvoice({ lineItems: manyLines, subtotalCents: 600000, totalCents: 600000, balanceCents: 600000 }),
      'en',
      t,
    )

    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThan(1)
  })

  it('renders correctly with the Spanish translator and locale-formatted currency', async () => {
    const t = await translator('es')
    const bytes = await renderInvoicePdf(sampleInvoice(), 'es', t)

    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe('%PDF')
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThan(0)
  })
})

function sampleSettlement(overrides: Partial<SettlementPdfData> = {}): SettlementPdfData {
  return {
    tenantName: 'Goliath Dispatch Demo',
    tenantAddressLines: ['123 Freight Way', 'Dallas, TX 75201'],
    logoPngBytes: null,
    timezone: 'America/Chicago',
    settlementNumber: 'STL-0042',
    carrierName: 'Acme Trucking LLC',
    carrierDotNumber: '1234567',
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-01-07T00:00:00Z'),
    issuedAt: new Date('2026-01-08T00:00:00Z'),
    lines: [
      {
        loadNumber: 'GD-1001',
        description: 'Dallas, TX → Denver, CO',
        grossRateCents: 250000,
        reimbursementsCents: 5000,
        dispatchFeeCents: 25000,
        deductionsCents: 0,
        netCents: 230000,
      },
    ],
    totals: {
      grossRateCents: 250000,
      reimbursementsCents: 5000,
      dispatchFeesCents: 25000,
      deductionsCents: 0,
      netAmountCents: 230000,
    },
    notes: null,
    ...overrides,
  }
}

describe('renderSettlementPdf', () => {
  it('renders a valid PDF containing the settlement number', async () => {
    const t = await translator('en')
    const bytes = await renderSettlementPdf(sampleSettlement(), 'en', t)

    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe('%PDF')
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThan(0)

    expect(decodeAllStreams(bytes)).toContain('STL-0042')
  })
})
