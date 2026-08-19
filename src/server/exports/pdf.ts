import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import { sanitizeForStandardFont, BRAND_NAVY, BRAND_ORANGE, INK, MUTED, HAIRLINE, WHITE } from '@/lib/pdf/document-builder'
import type { Locale } from '@/i18n/config'
import type { TranslateFn } from '@/i18n/translate'
import type { ReportColumn } from '@/server/reports/types'
import { formatCellValue } from './format'

/**
 * Report PDF generation.
 *
 * `src/lib/pdf/document-builder.ts` is fixed to US Letter portrait, which
 * cannot fit a report with more than four or five columns. Report tables are
 * often wide (revenue-by-dimension, carrier scorecards…), so this builds its
 * own landscape US Letter (792×612pt) document directly with pdf-lib —
 * reusing the same brand chrome constants and the WinAnsi text sanitizer
 * that `document-builder.ts` already exports, rather than duplicating them.
 */

const PAGE_WIDTH = 792
const PAGE_HEIGHT = 612
const MARGIN = 36
const HEADER_HEIGHT = 64
const FOOTER_HEIGHT = 28
const ROW_HEIGHT = 18

export interface PdfMetadata {
  reportTitle: string
  tenantName: string
  generatedByEmail: string
  generatedAt: Date
  locale: Locale
}

export async function buildPdf(
  columns: ReportColumn[],
  rows: Array<Record<string, unknown>>,
  locale: Locale,
  t: TranslateFn,
  timeZone: string,
  metadata: PdfMetadata,
): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(metadata.reportTitle)
  pdf.setProducer('Goliath Dispatch')
  pdf.setCreator('Goliath Dispatch')
  pdf.setLanguage(locale)

  const helvetica = await pdf.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const usableWidth = PAGE_WIDTH - MARGIN * 2
  const colWidth = Math.max(60, usableWidth / Math.max(1, columns.length))

  const pages: PDFPage[] = []

  function addPage(): { page: PDFPage; top: number; bottom: number } {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    pages.push(page)

    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_HEIGHT, width: PAGE_WIDTH, height: HEADER_HEIGHT, color: BRAND_NAVY })
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_HEIGHT - 3, width: PAGE_WIDTH, height: 3, color: BRAND_ORANGE })
    page.drawText(sanitizeForStandardFont(metadata.tenantName), {
      x: MARGIN,
      y: PAGE_HEIGHT - 26,
      size: 13,
      font: helveticaBold,
      color: WHITE,
    })
    page.drawText(sanitizeForStandardFont(metadata.reportTitle), {
      x: MARGIN,
      y: PAGE_HEIGHT - 44,
      size: 10,
      font: helvetica,
      color: WHITE,
    })

    return { page, top: PAGE_HEIGHT - HEADER_HEIGHT - 20, bottom: FOOTER_HEIGHT + 12 }
  }

  function drawCell(page: PDFPage, text: string, x: number, y: number, width: number, font: PDFFont, size: number, color = INK, align: 'left' | 'right' = 'left') {
    const safe = sanitizeForStandardFont(text).slice(0, 80)
    const textWidth = font.widthOfTextAtSize(safe, size)
    const textX = align === 'right' ? x + width - 4 - textWidth : x + 4
    page.drawText(safe, { x: textX, y, size, font, color })
  }

  const first = addPage()
  let page = first.page
  const { top, bottom } = first
  let y = top

  function drawHeaderRow() {
    page.drawRectangle({ x: MARGIN, y: y - ROW_HEIGHT, width: colWidth * columns.length, height: ROW_HEIGHT, color: BRAND_NAVY })
    let x = MARGIN
    for (const column of columns) {
      drawCell(page, t(column.labelKey), x, y - ROW_HEIGHT + 5, colWidth, helveticaBold, 8, WHITE, column.numeric ? 'right' : 'left')
      x += colWidth
    }
    y -= ROW_HEIGHT
  }

  drawHeaderRow()

  for (const row of rows) {
    if (y - ROW_HEIGHT < bottom) {
      const next = addPage()
      page = next.page
      y = next.top
      drawHeaderRow()
    }
    let x = MARGIN
    for (const column of columns) {
      const text = formatCellValue(row[column.key], column, locale, t, timeZone)
      drawCell(page, text, x, y - ROW_HEIGHT + 5, colWidth, helvetica, 8, INK, column.numeric ? 'right' : 'left')
      x += colWidth
    }
    page.drawLine({
      start: { x: MARGIN, y: y - ROW_HEIGHT },
      end: { x: MARGIN + colWidth * columns.length, y: y - ROW_HEIGHT },
      thickness: 0.5,
      color: HAIRLINE,
    })
    y -= ROW_HEIGHT
  }

  const total = pages.length
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: MARGIN, y: FOOTER_HEIGHT + 6 }, end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_HEIGHT + 6 }, thickness: 0.5, color: HAIRLINE })
    const label = `${metadata.generatedByEmail} · ${metadata.generatedAt.toISOString()} · ${index + 1} / ${total}`
    const width = helvetica.widthOfTextAtSize(label, 7)
    p.drawText(label, { x: PAGE_WIDTH - MARGIN - width, y: FOOTER_HEIGHT - 6, size: 7, font: helvetica, color: MUTED })
  })

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}
