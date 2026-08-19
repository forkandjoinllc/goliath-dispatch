'use client'

import * as React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime, formatMoney } from '@/i18n/translate'
import type { Escort, Load } from '@/db/schema'
import { EscortFormDialog } from './escort-form-dialog'

const STATUS_TONE: Record<Escort['status'], 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  pending: 'neutral',
  confirmed: 'info',
  completed: 'success',
  cancelled: 'danger',
  not_required: 'neutral',
}

export function EscortsList({
  rows,
  canManage,
  localePrefix,
  showLoadColumn = true,
}: {
  rows: Array<{ escort: Escort; load: Load }>
  canManage: boolean
  localePrefix: string
  showLoadColumn?: boolean
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const [editing, setEditing] = React.useState<Escort | null>(null)

  if (rows.length === 0) {
    return <EmptyState title={t('oversize.escorts.empty')} />
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {showLoadColumn ? <TableHead>{t('tracking.fleetView.loadColumn')}</TableHead> : null}
            <TableHead>{t('common.labels.type')}</TableHead>
            <TableHead>{t('oversize.permits.stateLabel')}</TableHead>
            <TableHead>{t('common.labels.status')}</TableHead>
            <TableHead>{t('oversize.escorts.scheduledForLabel')}</TableHead>
            <TableHead>{t('oversize.escorts.costLabel')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ escort, load }) => (
            <TableRow key={escort.id}>
              {showLoadColumn ? (
                <TableCell>
                  <Link href={`${localePrefix}/app/permits/oversize/${load.id}`} className="font-medium text-navy-700 hover:underline">
                    {load.loadNumber}
                  </Link>
                </TableCell>
              ) : null}
              <TableCell>{t(`oversize.escorts.type.${escort.escortType}`)}</TableCell>
              <TableCell className="font-semibold">{escort.stateCode ?? '—'}</TableCell>
              <TableCell>
                <Badge tone={STATUS_TONE[escort.status]}>{t(`oversize.escorts.status.${escort.status}`)}</Badge>
              </TableCell>
              <TableCell>{escort.scheduledFor ? formatDateTime(escort.scheduledFor, locale, timezone) : '—'}</TableCell>
              <TableCell>{formatMoney(escort.costCents, locale)}</TableCell>
              <TableCell>
                {canManage ? (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(escort)}>
                    {t('oversize.escorts.editButton')}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {editing ? (
        <EscortFormDialog
          loadId={editing.loadId}
          escort={editing}
          open={Boolean(editing)}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
    </>
  )
}

export function AddEscortButton({ loadId }: { loadId: string }) {
  const t = useTranslate()
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        {t('oversize.escorts.addButton')}
      </Button>
      <EscortFormDialog loadId={loadId} open={open} onOpenChange={setOpen} />
    </>
  )
}
