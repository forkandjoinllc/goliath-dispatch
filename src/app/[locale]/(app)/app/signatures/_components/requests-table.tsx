import Link from 'next/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime, type TranslateFn } from '@/i18n/translate'
import type { Locale } from '@/i18n/config'
import type { SignatureRequest } from '@/db/schema'
import { SignatureStatusBadge } from './status-badge'

export interface RequestRow {
  id: string
  signerEmail: string
  subjectType: string
  status: SignatureRequest['status']
  templateTitle: string
  templateVersion: number
  requestedAt: Date
  completedAt: Date | null
}

/** Server-rendered, non-interactive: every field arrives pre-resolved so this never needs a client boundary. */
export function RequestsTable({
  rows,
  locale,
  timezone,
  t,
}: {
  rows: RequestRow[]
  locale: Locale
  timezone: string
  t: TranslateFn
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('signature.fields.signer')}</TableHead>
          <TableHead>{t('signature.fields.subject')}</TableHead>
          <TableHead>{t('signature.fields.template')}</TableHead>
          <TableHead>{t('signature.fields.status')}</TableHead>
          <TableHead>{t('signature.fields.sentAt')}</TableHead>
          <TableHead>{t('signature.fields.signedAt')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link href={`/${locale}/app/signatures/${row.id}`} className="font-medium text-navy-700 hover:underline">
                {row.signerEmail}
              </Link>
            </TableCell>
            <TableCell>{t(`signature.subjectTypes.${row.subjectType}`)}</TableCell>
            <TableCell>
              {row.templateTitle} · {t('signature.fields.templateVersion', { version: row.templateVersion })}
            </TableCell>
            <TableCell>
              <SignatureStatusBadge status={row.status} t={t} />
            </TableCell>
            <TableCell>{formatDateTime(row.requestedAt, locale, timezone)}</TableCell>
            <TableCell>{row.completedAt ? formatDateTime(row.completedAt, locale, timezone) : '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
