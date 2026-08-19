import type { Locale } from '@/i18n/config'
import { formatDate, formatMoney, type TranslateFn } from '@/i18n/translate'
import { DocumentBuilder, MUTED, sanitizeForStandardFont, type TableColumn } from './document-builder'

export interface SettlementLineData {
  loadNumber: string
  description: string
  grossRateCents: number
  reimbursementsCents: number
  dispatchFeeCents: number
  deductionsCents: number
  netCents: number
}

export interface SettlementPdfData {
  tenantName: string
  tenantAddressLines: string[]
  logoPngBytes?: Uint8Array | null
  timezone: string

  settlementNumber: string
  carrierName: string
  carrierDotNumber?: string | null
  periodStart: Date
  periodEnd: Date
  issuedAt: Date | null

  lines: SettlementLineData[]
  totals: {
    grossRateCents: number
    reimbursementsCents: number
    dispatchFeesCents: number
    deductionsCents: number
    netAmountCents: number
  }

  notes?: string | null
}

/** Renders a carrier settlement statement — one row per load, one period total. */
export async function renderSettlementPdf(
  data: SettlementPdfData,
  locale: Locale,
  t: TranslateFn,
): Promise<Uint8Array> {
  const builder = await DocumentBuilder.create({
    tenantName: data.tenantName,
    documentTitle: t('document.pdf.settlementTitle'),
    logoPngBytes: data.logoPngBytes ?? null,
    locale,
  })

  const cursor = builder.addPage()
  let y = cursor.top

  for (const line of data.tenantAddressLines) {
    cursor.page.drawText(sanitizeForStandardFont(line), { x: cursor.left, y, size: 9, font: builder.helvetica, color: MUTED })
    y -= 12
  }
  y -= 8

  const metaRows: Array<[string, string]> = [
    [t('document.pdf.settlementNumber'), data.settlementNumber],
    [t('document.pdf.carrier'), data.carrierDotNumber ? `${data.carrierName} (DOT ${data.carrierDotNumber})` : data.carrierName],
    [
      t('document.pdf.period'),
      `${formatDate(data.periodStart, locale, data.timezone)} – ${formatDate(data.periodEnd, locale, data.timezone)}`,
    ],
    [t('document.pdf.issueDate'), formatDate(data.issuedAt, locale, data.timezone)],
  ]
  for (const [label, value] of metaRows) {
    cursor.page.drawText(label, { x: cursor.left, y, size: 9, font: builder.helvetica, color: MUTED })
    const labelWidth = builder.helvetica.widthOfTextAtSize(label, 9)
    cursor.page.drawText(sanitizeForStandardFont(value), { x: cursor.left + labelWidth + 8, y, size: 9, font: builder.helveticaBold })
    y -= 14
  }
  y -= 12

  const columns: TableColumn[] = [
    { header: t('document.pdf.columns.load'), width: 70 },
    { header: t('document.pdf.columns.description'), width: 140 },
    { header: t('document.pdf.columns.grossRate'), width: 78, align: 'right' },
    { header: t('document.pdf.columns.reimbursements'), width: 78, align: 'right' },
    { header: t('document.pdf.columns.dispatchFee'), width: 68, align: 'right' },
    { header: t('document.pdf.columns.deductions'), width: 68, align: 'right' },
    { header: t('document.pdf.columns.net'), width: 14 + 68, align: 'right' },
  ]
  const rows = data.lines.map((line) => [
    line.loadNumber,
    line.description,
    formatMoney(line.grossRateCents, locale),
    formatMoney(line.reimbursementsCents, locale),
    formatMoney(line.dispatchFeeCents, locale),
    formatMoney(line.deductionsCents, locale),
    formatMoney(line.netCents, locale),
  ])

  const tableResult = builder.layoutTable({
    page: cursor.page,
    columns,
    rows,
    x: cursor.left,
    y,
    bottom: cursor.bottom,
    bodySize: 8,
    headerSize: 8,
  })

  y = tableResult.y - 20

  const totalsX = cursor.right - 260
  const totalRows: Array<[string, number, boolean?]> = [
    [t('document.pdf.columns.grossRate'), data.totals.grossRateCents],
    [t('document.pdf.columns.reimbursements'), data.totals.reimbursementsCents],
    [t('document.pdf.columns.dispatchFee'), -data.totals.dispatchFeesCents],
    [t('document.pdf.columns.deductions'), -data.totals.deductionsCents],
    [t('document.pdf.periodTotal'), data.totals.netAmountCents, true],
  ]
  for (const [label, cents, emphasize] of totalRows) {
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
