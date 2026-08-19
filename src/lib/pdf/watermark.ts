import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import type { Locale } from '@/i18n/config'
import { formatDateTime, type TranslateFn } from '@/i18n/translate'

/**
 * Watermarking downloaded documents.
 *
 * Every download that isn't already an original upload (i.e. every rendered
 * PDF handed to a browser) gets a diagonal, repeating stamp naming the product
 * and the moment it was pulled, so a screenshot or a forwarded copy still
 * carries provenance. The stamp is intentionally low-opacity: it must not
 * obscure the underlying content.
 */

export interface WatermarkOptions {
  downloadedAt: Date
  locale: Locale
  tenantName: string
  timezone: string
  downloadedByEmail?: string | null
}

const STAMP_OPACITY = 0.14
const STAMP_COLOR = rgb(0.35, 0.4, 0.48)
const STAMP_ANGLE = degrees(38)

function buildStampLines(options: WatermarkOptions, t: TranslateFn): string[] {
  const wordmark = t('common.appName')
  const dateLabel = formatDateTime(options.downloadedAt, options.locale, options.timezone)
  const lines = [wordmark, t('document.watermark.downloadedOn', { date: dateLabel }), options.tenantName]
  if (options.downloadedByEmail) lines.push(options.downloadedByEmail)
  return lines
}

/** Stamps every page of a PDF with a repeating diagonal watermark. Returns new bytes; input is untouched. */
export async function watermarkPdf(
  bytes: Uint8Array,
  options: WatermarkOptions,
  t: TranslateFn,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes)
  const font = await pdf.embedFont(StandardFonts.HelveticaBold)
  const stampText = buildStampLines(options, t).join('   •   ')
  const fontSize = 16

  for (const page of pdf.getPages()) {
    stampPage(page, font, fontSize, stampText)
  }

  return pdf.save()
}

/**
 * Watermarks an image (JPG/PNG) by placing it, stamped, on a single-page PDF.
 * This product's private downloads are always served as PDF once watermarked
 * — a stamped raster image would either need the mark baked destructively
 * into the pixels (no clean "unwatermarked original" story) or a sidecar
 * format the rest of the download pipeline doesn't understand. Wrapping in a
 * one-page PDF keeps the stamp vector-crisp and keeps `getDownloadUrl`'s
 * "watermark → signed URL" contract identical for every document type.
 */
export async function watermarkImage(
  bytes: Uint8Array,
  contentType: 'image/png' | 'image/jpeg',
  options: WatermarkOptions,
  t: TranslateFn,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const image = contentType === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  const font = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Fit the image onto a Letter-sized canvas with margins, in whichever
  // orientation lets it render largest.
  const maxWidth = 612 - 96
  const maxHeight = 792 - 96
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1)
  const width = image.width * scale
  const height = image.height * scale
  const pageWidth = width + 96
  const pageHeight = height + 96

  const page = pdf.addPage([pageWidth, pageHeight])
  page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height })

  const stampText = buildStampLines(options, t).join('   •   ')
  stampPage(page, font, 16, stampText)

  return pdf.save()
}

function stampPage(
  page: import('pdf-lib').PDFPage,
  font: import('pdf-lib').PDFFont,
  fontSize: number,
  stampText: string,
): void {
  const { width, height } = page.getSize()
  const textWidth = font.widthOfTextAtSize(stampText, fontSize)
  const stepX = textWidth + 90
  const stepY = fontSize + 70
  const diagonal = Math.sqrt(width * width + height * height)

  // Overshoot the page bounds in every direction so the 38° rotation still
  // covers the corners once rendered.
  for (let y = -diagonal; y < diagonal; y += stepY) {
    for (let x = -diagonal; x < diagonal; x += stepX) {
      page.drawText(stampText, {
        x,
        y,
        size: fontSize,
        font,
        color: STAMP_COLOR,
        opacity: STAMP_OPACITY,
        rotate: STAMP_ANGLE,
      })
    }
  }
}
