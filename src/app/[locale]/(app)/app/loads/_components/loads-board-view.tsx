'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { KanbanBoard } from '@/components/data/kanban-board'
import { EmptyState } from '@/components/ui/feedback'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate } from '@/i18n/translate'
import type { LoadListRow } from '@/server/loads/queries'
import { LOAD_STATUSES, type LoadStatus } from '@/server/loads/status-machine'
import { transitionLoadStatusAction } from '@/server/loads/actions'

/**
 * A dispatch board only needs the statuses a load actually moves through
 * before it is closed out by accounting — `invoiced`/`paid` stay visible in
 * the table view but would just clutter a drag board.
 */
const BOARD_STATUSES: LoadStatus[] = LOAD_STATUSES.filter((s) => s !== 'invoiced' && s !== 'paid')

function statusI18nKey(status: LoadStatus): string {
  return status.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

export function LoadsBoardView({ locale, rows }: { locale: string; rows: LoadListRow[] }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const { locale: i18nLocale, timezone } = useI18n()
  const [items, setItems] = React.useState(rows)

  React.useEffect(() => setItems(rows), [rows])

  const boardItems = items.filter((row) => BOARD_STATUSES.includes(row.load.status as LoadStatus))
  if (rows.length === 0) return <EmptyState title={t('load.states.emptyBoard')} />

  async function handleMove(itemId: string, toColumn: LoadStatus) {
    const result = await transitionLoadStatusAction({ loadId: itemId, to: toColumn })
    if (result.ok) {
      setItems((prev) => prev.map((row) => (row.load.id === itemId ? { ...row, load: result.data } : row)))
      router.refresh()
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  return (
    <KanbanBoard<LoadListRow, LoadStatus>
      columns={BOARD_STATUSES.map((status) => ({ id: status, label: t(`nav.status.load.${statusI18nKey(status)}`) }))}
      items={boardItems}
      getItemId={(row) => row.load.id}
      getItemColumn={(row) => row.load.status as LoadStatus}
      onMove={handleMove}
      dragHandleLabel={(row) => t('load.loadNumber', { number: row.load.loadNumber })}
      moveMenuLabel={(row) => row.load.loadNumber}
      moveToLabel={(columnLabel) => `${t('common.actions.select')} ${columnLabel}`}
      announceMove={(row, columnLabel) => `${row.load.loadNumber} → ${columnLabel}`}
      renderCard={(row) => (
        <a href={`/${locale}/app/loads/${row.load.id}`} className="block">
          <p className="font-semibold text-navy-700">{row.load.loadNumber}</p>
          <p className="text-xs text-steel-600">{row.customerName}</p>
          {row.carrierName ? <p className="text-xs text-steel-600">{row.carrierName}</p> : null}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {row.load.plannedPickupAt ? (
              <Badge tone="neutral">{formatDate(row.load.plannedPickupAt, i18nLocale, timezone)}</Badge>
            ) : null}
            {row.load.isOversize || row.load.isOverweight ? <Badge tone="warning">{t('load.fields.oversize')}</Badge> : null}
          </div>
        </a>
      )}
    />
  )
}
