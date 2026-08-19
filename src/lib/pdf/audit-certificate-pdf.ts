import type { Locale } from '@/i18n/config'
import { formatDateTime, type TranslateFn } from '@/i18n/translate'
import { DocumentBuilder, INK, MUTED, sanitizeForStandardFont, type TableColumn } from './document-builder'

export interface CeremonyEventData {
  eventType: string
  occurredAt: Date
  actorEmail?: string | null
  ipAddress?: string | null
  eventHash: string
}

export interface AuditCertificatePdfData {
  tenantName: string
  logoPngBytes?: Uint8Array | null
  timezone: string

  requestId: string
  subjectDescription: string

  templateKey: string
  templateVersion: number
  templateContentHash: string

  documentSha256: string
  signatureSha256: string
  integritySeal: string
  sealAlgorithm: string

  signer: { legalName: string; email: string; signedAt: Date }
  events: CeremonyEventData[]
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`
}

/**
 * Renders the signature audit certificate: every hash a counterparty would
 * need to independently verify the ceremony, plus the full chronological
 * event list. This is the document a court or an auditor gets — it never
 * omits an event, and it shows full hashes for the primary seals even though
 * the ceremony log below abbreviates them for legibility.
 */
export async function renderAuditCertificatePdf(
  data: AuditCertificatePdfData,
  locale: Locale,
  t: TranslateFn,
): Promise<Uint8Array> {
  const builder = await DocumentBuilder.create({
    tenantName: data.tenantName,
    documentTitle: t('document.pdf.auditCertificateTitle'),
    logoPngBytes: data.logoPngBytes ?? null,
    locale,
  })

  let cursor = builder.addPage()
  let y = cursor.top

  cursor.page.drawText(t('document.pdf.auditCertificateTitle'), {
    x: cursor.left,
    y,
    size: 13,
    font: builder.helveticaBold,
    color: INK,
  })
  y -= 20
  cursor.page.drawText(sanitizeForStandardFont(data.subjectDescription), { x: cursor.left, y, size: 10, font: builder.helvetica, color: MUTED })
  y -= 24

  const integrityRows: Array<[string, string]> = [
    [t('document.pdf.requestId'), data.requestId],
    [t('document.pdf.signer'), `${data.signer.legalName} <${data.signer.email}>`],
    [t('document.pdf.signedAt', { date: formatDateTime(data.signer.signedAt, locale, data.timezone) }), ''],
    [t('document.pdf.templateKey'), `${data.templateKey} v${data.templateVersion}`],
    [t('document.pdf.templateHash'), data.templateContentHash],
    [t('document.pdf.documentHash'), data.documentSha256],
    [t('document.pdf.signatureHash'), data.signatureSha256],
    [t('document.pdf.integritySeal'), `${data.integritySeal} (${data.sealAlgorithm})`],
  ]

  for (const [label, value] of integrityRows) {
    if (y - 26 < cursor.bottom) {
      cursor = builder.addPage()
      y = cursor.top
    }
    cursor.page.drawText(label, { x: cursor.left, y, size: 9, font: builder.helveticaBold, color: INK })
    y -= 12
    if (value) {
      cursor.page.drawText(sanitizeForStandardFont(value), { x: cursor.left, y, size: 8.5, font: builder.helvetica, color: MUTED })
      y -= 16
    } else {
      y -= 4
    }
  }

  y -= 12
  if (y - 40 < cursor.bottom) {
    cursor = builder.addPage()
    y = cursor.top
  }
  cursor.page.drawText(t('document.pdf.ceremonyLog'), { x: cursor.left, y, size: 11, font: builder.helveticaBold })
  y -= 18

  const columns: TableColumn[] = [
    { header: t('document.pdf.columns.timestamp'), width: 110 },
    { header: t('document.pdf.columns.event'), width: 130 },
    { header: t('document.pdf.columns.actor'), width: 130 },
    { header: t('document.pdf.columns.ipAddress'), width: 90 },
    { header: t('document.pdf.columns.eventHash'), width: 44 + 60 },
  ]
  const rows = data.events.map((event) => [
    formatDateTime(event.occurredAt, locale, data.timezone),
    t.optional(`document.certificate.events.${event.eventType}`) ?? event.eventType,
    event.actorEmail ?? '—',
    event.ipAddress ?? '—',
    truncateHash(event.eventHash),
  ])

  builder.layoutTable({
    page: cursor.page,
    columns,
    rows,
    x: cursor.left,
    y,
    bottom: cursor.bottom,
    bodySize: 7.5,
    headerSize: 8,
  })

  builder.finalizeFooters((page, total) => t('document.pdf.pageOf', { page, total }))
  return builder.save()
}
