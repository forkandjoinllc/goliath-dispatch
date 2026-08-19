'use client'

import * as React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { ExpiryBadge } from '@/components/status/expiry-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatMoney } from '@/i18n/translate'
import type { Load, Permit } from '@/db/schema'
import { PermitFormDialog } from './permit-form-dialog'

const STATUS_TONE: Record<Permit['status'], 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  pending: 'neutral',
  requested: 'info',
  issued: 'success',
  expired: 'danger',
  rejected: 'danger',
  not_required: 'neutral',
}

export function PermitsList({
  rows,
  canManage,
  localePrefix,
  showLoadColumn = true,
}: {
  rows: Array<{ permit: Permit; load: Load }>
  canManage: boolean
  localePrefix: string
  showLoadColumn?: boolean
}) {
  const t = useTranslate()
  const { locale } = useI18n()
  const [editing, setEditing] = React.useState<Permit | null>(null)

  if (rows.length === 0) {
    return <EmptyState title={t('oversize.permits.empty')} />
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {showLoadColumn ? <TableHead>{t('tracking.fleetView.loadColumn')}</TableHead> : null}
            <TableHead>{t('oversize.permits.stateLabel')}</TableHead>
            <TableHead>{t('oversize.permits.permitTypeLabel')}</TableHead>
            <TableHead>{t('common.labels.status')}</TableHead>
            <TableHead>{t('oversize.permits.expiresAtLabel')}</TableHead>
            <TableHead>{t('oversize.permits.costLabel')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ permit, load }) => (
            <TableRow key={permit.id}>
              {showLoadColumn ? (
                <TableCell>
                  <Link href={`${localePrefix}/app/permits/oversize/${load.id}`} className="font-medium text-navy-700 hover:underline">
                    {load.loadNumber}
                  </Link>
                </TableCell>
              ) : null}
              <TableCell className="font-semibold">{permit.stateCode}</TableCell>
              <TableCell>{permit.permitType ?? '—'}</TableCell>
              <TableCell>
                <Badge tone={STATUS_TONE[permit.status]}>{t(`oversize.permits.status.${permit.status}`)}</Badge>
              </TableCell>
              <TableCell>
                <ExpiryBadge date={permit.expiresAt} />
              </TableCell>
              <TableCell>{formatMoney(permit.costCents, locale)}</TableCell>
              <TableCell>
                {canManage ? (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(permit)}>
                    {t('oversize.permits.editButton')}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {editing ? (
        <PermitFormDialog
          loadId={editing.loadId}
          permit={editing}
          open={Boolean(editing)}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
    </>
  )
}

/** Add-permit trigger, used on the per-load workspace page where a loadId is already known. */
export function AddPermitButton({ loadId }: { loadId: string }) {
  const t = useTranslate()
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        {t('oversize.permits.addButton')}
      </Button>
      <PermitFormDialog loadId={loadId} open={open} onOpenChange={setOpen} />
    </>
  )
}
