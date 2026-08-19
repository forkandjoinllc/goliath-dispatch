import type { Locale } from '@/i18n/config'
import { formatDate, formatMoney, type TranslateFn } from '@/i18n/translate'
import { DocumentBuilder, MUTED, sanitizeForStandardFont, type TableColumn } from './document-builder'

export interface InvoiceLineItemData {
  description: string
  quantity: number
  unitAmountCents: number
  amountCents: number
}

export interface InvoicePdfData {
  tenantName: string
  tenantAddressLines: string[]
  logoPngBytes?: Uint8Array | null
  timezone: string

  invoiceNumber: string
  issueDate: Date | null
  dueDate: Date | null
  paymentTermsDays: number

  billTo: { name: string; addressLines: string[] }

  lineItems: InvoiceLineItemData[]
  subtotalCents: number
  adjustmentsCents: number
  totalCents: number
  amountPaidCents: number
  balanceCents: number

  notes?: string | null
}

/** Renders a carrier-facing dispatch-fee invoice. Every label is resolved through `t`. */
export async function renderInvoicePdf(data: InvoicePdfData, locale: Locale, t: TranslateFn): Promise<Uint8Array> {
  const builder = await DocumentBuilder.create({
    tenantName: data.tenantName,
    documentTitle: t('document.pdf.invoiceTitle'),
    logoPngBytes: data.logoPngBytes ?? null,
    locale,
  })

  const cursor = builder.addPage()
  let y = cursor.top

  // Two-column meta block: tenant address on the left, invoice facts on the right.
  const leftColumnWidth = (cursor.right - cursor.left) * 0.55
  const rightColumnX = cursor.left + leftColumnWidth + 24

  let leftY = y
  for (const line of data.tenantAddressLines) {
    cursor.page.drawText(sanitizeForStandardFont(line), { x: cursor.left, y: leftY, size: 9, font: builder.helvetica, color: MUTED })
    leftY -= 12
  }

  const metaRows: Array<[string, string]> = [
    [t('document.pdf.invoiceNumber'), data.invoiceNumber],
    [t('document.pdf.issueDate'), formatDate(data.issueDate, locale, data.timezone)],
    [t('document.pdf.dueDate'), formatDate(data.dueDate, locale, data.timezone)],
    [t('document.pdf.paymentTerms', { days: data.paymentTermsDays }), ''],
  ]
  let rightY = y
  for (const [label, value] of metaRows) {
    if (!value) {
      cursor.page.drawText(label, { x: rightColumnX, y: rightY, size: 9, font: builder.helvetica, color: MUTED })
    } else {
      cursor.page.drawText(label, { x: rightColumnX, y: rightY, size: 9, font: builder.helvetica, color: MUTED })
      const labelWidth = builder.helvetica.widthOfTextAtSize(label, 9)
      cursor.page.drawText(sanitizeForStandardFont(value), {
        x: rightColumnX + labelWidth + 8,
        y: rightY,
        size: 9,
        font: builder.helveticaBold,
      })
    }
    rightY -= 14
  }

  y = Math.min(leftY, rightY) - 20

  // Bill-to block.
  cursor.page.drawText(t('document.pdf.billTo'), {
    x: cursor.left,
    y,
    size: 10,
    font: builder.helveticaBold,
  })
  y -= 14
  cursor.page.drawText(sanitizeForStandardFont(data.billTo.name), { x: cursor.left, y, size: 10, font: builder.helvetica })
  y -= 13
  for (const line of data.billTo.addressLines) {
    cursor.page.drawText(sanitizeForStandardFont(line), { x: cursor.left, y, size: 9, font: builder.helvetica, color: MUTED })
    y -= 12
  }

  y -= 16

  const columns: TableColumn[] = [
    { header: t('document.pdf.columns.description'), width: 250 },
    { header: t('document.pdf.columns.quantity'), width: 60, align: 'right' },
    { header: t('document.pdf.columns.unitPrice'), width: 100, align: 'right' },
    { header: t('document.pdf.columns.amount'), width: 106, align: 'right' },
  ]
  const rows = data.lineItems.map((item) => [
    item.description,
    String(item.quantity),
    formatMoney(item.unitAmountCents, locale),
    formatMoney(item.amountCents, locale),
  ])

  const tableResult = builder.layoutTable({
    page: cursor.page,
    columns,
    rows,
    x: cursor.left,
    y,
    bottom: cursor.bottom,
  })

  y = tableResult.y - 16

  const totalsX = cursor.right - 220
  const totals: Array<[string, number, boolean?]> = [
    [t('common.labels.subtotal'), data.subtotalCents],
    [t('document.pdf.adjustments'), data.adjustmentsCents],
    [t('common.labels.total'), data.totalCents, true],
    [t('document.pdf.amountPaid'), -data.amountPaidCents],
    [t('common.labels.balance'), data.balanceCents, true],
  ]
  for (const [label, cents, emphasize] of totals) {
    const font = emphasize ? builder.helveticaBold : builder.helvetica
    tableResult.page.drawText(label, { x: totalsX, y, size: 10, font })
    const amount = formatMoney(cents, locale)
    const width = font.widthOfTextAtSize(amount, 10)
    tableResult.page.drawText(amount, { x: cursor.right - width, y, size: 10, font })
    y -= 16
  }

  if (data.notes) {
    y -= 12
    tableResult.page.drawText(t('common.labels.notes'), { x: cursor.left, y, size: 9, font: builder.helveticaBold })
    y -= 12
    for (const line of data.notes.split('\n')) {
      tableResult.page.drawText(sanitizeForStandardFont(line), { x: cursor.left, y, size: 9, font: builder.helvetica, color: MUTED })
      y -= 11
    }
  }

  builder.finalizeFooters((page, total) => t('document.pdf.pageOf', { page, total }))
  return builder.save()
}
