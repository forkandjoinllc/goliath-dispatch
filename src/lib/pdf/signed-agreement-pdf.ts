import type { Locale } from '@/i18n/config'
import { formatDateTime, type TranslateFn } from '@/i18n/translate'
import { DocumentBuilder, INK, MUTED, sanitizeForStandardFont, wrapText } from './document-builder'

export interface SignedAgreementSigner {
  legalName: string
  title?: string | null
  email: string
  signedAt: Date
  ipAddress: string
  timezone: string
}

export interface SignedAgreementPdfData {
  tenantName: string
  logoPngBytes?: Uint8Array | null
  documentTitle: string
  /** Plain-text agreement body with tokens already resolved. Blank lines separate paragraphs. */
  bodyText: string
  signatureImageBytes: Uint8Array
  signatureImageContentType: 'image/png' | 'image/jpeg'
  consentCopy: string
  signer: SignedAgreementSigner
}

/**
 * Renders the flattened, signed agreement: body, the captured signature
 * image, and the signer block. The returned bytes are exactly what gets
 * SHA-256'd into `signatureRecords.documentSha256` — nothing is added after
 * this call, so the hash proves the document as the signer saw it.
 */
export async function renderSignedAgreementPdf(
  data: SignedAgreementPdfData,
  locale: Locale,
  t: TranslateFn,
): Promise<Uint8Array> {
  const builder = await DocumentBuilder.create({
    tenantName: data.tenantName,
    documentTitle: data.documentTitle,
    logoPngBytes: data.logoPngBytes ?? null,
    locale,
  })

  let cursor = builder.addPage()
  let y = cursor.top
  const bodySize = 10
  const lineHeight = 13
  const maxWidth = cursor.right - cursor.left

  for (const paragraph of data.bodyText.split('\n\n')) {
    const lines = wrapText(paragraph.trim(), builder.helvetica, bodySize, maxWidth)
    for (const line of lines) {
      if (y - lineHeight < cursor.bottom) {
        cursor = builder.addPage()
        y = cursor.top
      }
      cursor.page.drawText(line, { x: cursor.left, y, size: bodySize, font: builder.helvetica, color: INK })
      y -= lineHeight
    }
    y -= lineHeight / 2
  }

  // Consent copy, set apart visually from the agreement body.
  y -= 10
  if (y - 60 < cursor.bottom) {
    cursor = builder.addPage()
    y = cursor.top
  }
  cursor.page.drawText(t('document.pdf.consent'), {
    x: cursor.left,
    y,
    size: 9,
    font: builder.helveticaBold,
  })
  y -= 12
  for (const line of wrapText(data.consentCopy, builder.helvetica, 8.5, maxWidth)) {
    if (y - 11 < cursor.bottom) {
      cursor = builder.addPage()
      y = cursor.top
    }
    cursor.page.drawText(line, { x: cursor.left, y, size: 8.5, font: builder.helvetica, color: MUTED })
    y -= 11
  }

  // Signature block.
  y -= 24
  const signatureBlockHeight = 140
  if (y - signatureBlockHeight < cursor.bottom) {
    cursor = builder.addPage()
    y = cursor.top
  }

  cursor.page.drawText(t('document.pdf.signature'), { x: cursor.left, y, size: 10, font: builder.helveticaBold })
  y -= 16

  const signatureImage =
    data.signatureImageContentType === 'image/png'
      ? await builder.pdf.embedPng(data.signatureImageBytes)
      : await builder.pdf.embedJpg(data.signatureImageBytes)
  const maxSigWidth = 220
  const maxSigHeight = 70
  const scale = Math.min(maxSigWidth / signatureImage.width, maxSigHeight / signatureImage.height, 1)
  const sigWidth = signatureImage.width * scale
  const sigHeight = signatureImage.height * scale
  cursor.page.drawImage(signatureImage, { x: cursor.left, y: y - sigHeight, width: sigWidth, height: sigHeight })
  cursor.page.drawLine({
    start: { x: cursor.left, y: y - sigHeight - 4 },
    end: { x: cursor.left + maxSigWidth, y: y - sigHeight - 4 },
    thickness: 0.5,
    color: MUTED,
  })
  y -= sigHeight + 18

  const signerLines = [
    data.signer.title ? `${data.signer.legalName} — ${data.signer.title}` : data.signer.legalName,
    data.signer.email,
    t('document.pdf.signedAt', { date: formatDateTime(data.signer.signedAt, locale, data.signer.timezone) }),
    t('document.pdf.signedFrom', { ip: data.signer.ipAddress }),
  ]
  for (const line of signerLines) {
    cursor.page.drawText(sanitizeForStandardFont(line), { x: cursor.left, y, size: 9, font: builder.helvetica, color: INK })
    y -= 13
  }

  builder.finalizeFooters((page, total) => t('document.pdf.pageOf', { page, total }))
  return builder.save()
}
