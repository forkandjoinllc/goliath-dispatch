import { type PDFFont, type PDFImage, type PDFPage, PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Locale } from '@/i18n/config'

/**
 * Thin, typed layout helper over pdf-lib.
 *
 * pdf-lib's raw API is coordinate soup — every generated document in this
 * product (invoices, settlements, signed agreements, audit certificates)
 * wants the same navy header band / orange rule / paginated footer, so that
 * chrome lives here once instead of four times with four chances to drift.
 *
 * Fonts are pdf-lib's built-in Helvetica family only: no network fetch, no
 * font file to ship, and Helvetica renders identically wherever the bytes are
 * later opened.
 */

export const BRAND_NAVY = rgb(0x06 / 255, 0x2b / 255, 0x5c / 255)
export const BRAND_ORANGE = rgb(0xff / 255, 0x5a / 255, 0x00 / 255)
export const INK = rgb(0x11 / 255, 0x18 / 255, 0x27 / 255)
export const MUTED = rgb(0x55 / 255, 0x55 / 255, 0x55 / 255)
export const HAIRLINE = rgb(0.85, 0.85, 0.85)
export const WHITE = rgb(1, 1, 1)

export const PAGE_WIDTH = 612 // US Letter, points
export const PAGE_HEIGHT = 792
export const MARGIN = 48
const HEADER_HEIGHT = 92
const ACCENT_HEIGHT = 4
const FOOTER_HEIGHT = 40

export interface DocumentBuilderOptions {
  tenantName: string
  documentTitle: string
  /** Tenant (or platform) logo, already decoded to PNG bytes. */
  logoPngBytes?: Uint8Array | null
  locale: Locale
}

export interface PageCursor {
  page: PDFPage
  /** Top of the writable area, below the header band. */
  top: number
  /** Bottom of the writable area, above the footer rule. */
  bottom: number
  left: number
  right: number
}

export interface TableColumn {
  header: string
  width: number
  align?: 'left' | 'right' | 'center'
}

export interface TableLayoutInput {
  page: PDFPage
  columns: TableColumn[]
  rows: string[][]
  x: number
  y: number
  bottom: number
  rowHeight?: number
  headerSize?: number
  bodySize?: number
}

export interface TableLayoutResult {
  page: PDFPage
  y: number
}

/**
 * pdf-lib's standard (non-embedded) fonts can only encode WinAnsi (cp1252).
 * Free text in this product — load descriptions, notes, signer names,
 * consent copy — is typed by users and routinely contains characters cp1252
 * has no slot for (curly quotes pasted from a word processor, em dashes,
 * arrows, emoji). Left alone, `font.widthOfTextAtSize`/`drawText` throw and
 * take down PDF generation entirely. This maps the common offenders to a
 * WinAnsi-safe equivalent and drops anything else to `?` rather than crash —
 * a degraded character in a rendered PDF is recoverable; a 500 on every
 * invoice a carrier's name happens to contain isn't.
 */
const UNICODE_TO_WINANSI: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '→': '->',
  '←': '<-',
  '•': '•', // bullet — natively in cp1252 (0x95)
}

export function sanitizeForStandardFont(text: string): string {
  let out = ''
  for (const char of text) {
    const mapped = UNICODE_TO_WINANSI[char]
    if (mapped !== undefined) {
      out += mapped
      continue
    }
    const code = char.codePointAt(0) ?? 0
    // cp1252 only has meaningful assignments up to 0xFF, and even a few gaps
    // inside that range; anything higher is definitely unsupported by a
    // standard font. This is a conservative approximation, not a full
    // cp1252 table, which is an acceptable trade for "never crash".
    out += code <= 0xff ? char : '?'
  }
  return out
}

/** Word-wraps `text` to fit within `maxWidth` at the given font/size. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of sanitizeForStandardFont(text).split('\n')) {
    if (paragraph.trim().length === 0) {
      lines.push('')
      continue
    }
    const words = paragraph.split(/\s+/).filter(Boolean)
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
        lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    if (current) lines.push(current)
  }
  return lines
}

export class DocumentBuilder {
  readonly pdf: PDFDocument
  readonly helvetica: PDFFont
  readonly helveticaBold: PDFFont
  private readonly logoImage: PDFImage | null
  private readonly options: DocumentBuilderOptions
  private readonly pages: PDFPage[] = []

  private constructor(
    pdf: PDFDocument,
    helvetica: PDFFont,
    helveticaBold: PDFFont,
    logoImage: PDFImage | null,
    options: DocumentBuilderOptions,
  ) {
    this.pdf = pdf
    this.helvetica = helvetica
    this.helveticaBold = helveticaBold
    this.logoImage = logoImage
    this.options = options
  }

  static async create(options: DocumentBuilderOptions): Promise<DocumentBuilder> {
    const pdf = await PDFDocument.create()
    pdf.setTitle(options.documentTitle)
    pdf.setProducer('Goliath Dispatch')
    pdf.setCreator('Goliath Dispatch')
    pdf.setLanguage(options.locale)

    const helvetica = await pdf.embedFont(StandardFonts.Helvetica)
    const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const logoImage = options.logoPngBytes ? await pdf.embedPng(options.logoPngBytes) : null

    return new DocumentBuilder(pdf, helvetica, helveticaBold, logoImage, options)
  }

  /** Adds a fresh page, draws the header band, and returns the writable cursor. */
  addPage(): PageCursor {
    const page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.pages.push(page)
    this.drawHeaderBand(page)
    return {
      page,
      top: PAGE_HEIGHT - HEADER_HEIGHT - ACCENT_HEIGHT - 20,
      bottom: FOOTER_HEIGHT + 16,
      left: MARGIN,
      right: PAGE_WIDTH - MARGIN,
    }
  }

  private drawHeaderBand(page: PDFPage): void {
    const bandTop = PAGE_HEIGHT
    const bandHeight = HEADER_HEIGHT

    page.drawRectangle({
      x: 0,
      y: bandTop - bandHeight,
      width: PAGE_WIDTH,
      height: bandHeight,
      color: BRAND_NAVY,
    })
    page.drawRectangle({
      x: 0,
      y: bandTop - bandHeight - ACCENT_HEIGHT,
      width: PAGE_WIDTH,
      height: ACCENT_HEIGHT,
      color: BRAND_ORANGE,
    })

    let textLeft = MARGIN
    if (this.logoImage) {
      const maxLogoHeight = bandHeight - 32
      const scale = Math.min(140 / this.logoImage.width, maxLogoHeight / this.logoImage.height, 1)
      const width = this.logoImage.width * scale
      const height = this.logoImage.height * scale
      page.drawImage(this.logoImage, {
        x: MARGIN,
        y: bandTop - bandHeight / 2 - height / 2,
        width,
        height,
      })
      textLeft = MARGIN + width + 16
    }

    page.drawText(sanitizeForStandardFont(this.options.tenantName), {
      x: textLeft,
      y: bandTop - 38,
      size: 15,
      font: this.helveticaBold,
      color: WHITE,
    })
    page.drawText(sanitizeForStandardFont(this.options.documentTitle), {
      x: textLeft,
      y: bandTop - 58,
      size: 10,
      font: this.helvetica,
      color: WHITE,
    })
  }

  /**
   * Lays out a simple bordered-header table, starting new pages (each with a
   * repeated header row) as rows run past `bottom`. Returns the final cursor
   * position so callers can keep writing below the table.
   */
  layoutTable(input: TableLayoutInput): TableLayoutResult {
    const rowHeight = input.rowHeight ?? 20
    const headerSize = input.headerSize ?? 9
    const bodySize = input.bodySize ?? 9

    let page = input.page
    let y = input.y

    const drawHeaderRow = () => {
      let x = input.x
      const headerTop = y
      page.drawRectangle({
        x: input.x,
        y: headerTop - rowHeight,
        width: input.columns.reduce((sum, c) => sum + c.width, 0),
        height: rowHeight,
        color: BRAND_NAVY,
      })
      for (const column of input.columns) {
        this.drawCell(page, column.header, x, headerTop - rowHeight, column.width, rowHeight, {
          font: this.helveticaBold,
          size: headerSize,
          color: WHITE,
          align: column.align,
        })
        x += column.width
      }
      y = headerTop - rowHeight
    }

    drawHeaderRow()

    for (const row of input.rows) {
      if (y - rowHeight < input.bottom) {
        const cursor = this.addPage()
        page = cursor.page
        y = cursor.top
        drawHeaderRow()
      }

      let x = input.x
      const rowTop = y
      for (let i = 0; i < input.columns.length; i += 1) {
        const column = input.columns[i]!
        this.drawCell(page, row[i] ?? '', x, rowTop - rowHeight, column.width, rowHeight, {
          font: this.helvetica,
          size: bodySize,
          color: INK,
          align: column.align,
        })
        x += column.width
      }
      page.drawLine({
        start: { x: input.x, y: rowTop - rowHeight },
        end: { x: input.x + input.columns.reduce((sum, c) => sum + c.width, 0), y: rowTop - rowHeight },
        thickness: 0.5,
        color: HAIRLINE,
      })
      y = rowTop - rowHeight
    }

    return { page, y }
  }

  private drawCell(
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    style: { font: PDFFont; size: number; color: ReturnType<typeof rgb>; align?: 'left' | 'right' | 'center' },
  ): void {
    const safeText = sanitizeForStandardFont(text)
    const padding = 6
    const textWidth = style.font.widthOfTextAtSize(safeText, style.size)
    let textX = x + padding
    if (style.align === 'right') textX = x + width - padding - textWidth
    if (style.align === 'center') textX = x + width / 2 - textWidth / 2
    page.drawText(safeText, {
      x: textX,
      y: y + height / 2 - style.size / 2 + 1,
      size: style.size,
      font: style.font,
      color: style.color,
    })
  }

  /** Draws the page-number footer on every page emitted so far. Call once, last. */
  finalizeFooters(pageLabel: (page: number, total: number) => string): void {
    const total = this.pages.length
    this.pages.forEach((page, index) => {
      page.drawLine({
        start: { x: MARGIN, y: FOOTER_HEIGHT + 8 },
        end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_HEIGHT + 8 },
        thickness: 0.5,
        color: HAIRLINE,
      })
      const label = pageLabel(index + 1, total)
      const width = this.helvetica.widthOfTextAtSize(label, 8)
      page.drawText(label, {
        x: PAGE_WIDTH - MARGIN - width,
        y: FOOTER_HEIGHT - 8,
        size: 8,
        font: this.helvetica,
        color: MUTED,
      })
    })
  }

  async save(): Promise<Uint8Array> {
    return this.pdf.save()
  }
}
