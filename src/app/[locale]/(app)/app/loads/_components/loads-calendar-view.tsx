'use client'

import { StatusBadge } from '@/components/status/status-badge'
import { EmptyState } from '@/components/ui/feedback'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate, formatDateTime } from '@/i18n/translate'
import type { LoadListRow } from '@/server/loads/queries'

/**
 * A day-by-day agenda grouped by planned pickup date — the dispatch-floor
 * equivalent of "what moves today, tomorrow, this week" rather than a full
 * month grid, which is far less useful for a rolling operational board.
 */
export function LoadsCalendarView({ locale, rows }: { locale: string; rows: LoadListRow[] }) {
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()

  const withPickup = rows.filter((row) => row.load.plannedPickupAt)
  if (withPickup.length === 0) return <EmptyState title={t('load.states.emptyCalendar')} />

  const groups = new Map<string, LoadListRow[]>()
  for (const row of withPickup) {
    const key = row.load.plannedPickupAt!.toISOString().slice(0, 10)
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  const sortedKeys = [...groups.keys()].sort()

  return (
    <div className="space-y-6">
      {sortedKeys.map((key) => {
        const dayRows = groups.get(key)!.sort((a, b) => a.load.plannedPickupAt!.getTime() - b.load.plannedPickupAt!.getTime())
        return (
          <section key={key}>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-steel-600">
              {formatDate(new Date(key), i18nLocale, timezone)}
            </h3>
            <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
              {dayRows.map((row) => (
                <li key={row.load.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <a href={`/${locale}/app/loads/${row.load.id}`} className="min-w-0">
                    <p className="font-semibold text-navy-700 hover:underline">{row.load.loadNumber}</p>
                    <p className="text-xs text-steel-600">
                      {row.customerName}
                      {row.carrierName ? ` · ${row.carrierName}` : ''}
                    </p>
                  </a>
                  <div className="flex items-center gap-3 text-xs text-steel-600">
                    <span>{formatDateTime(row.load.plannedPickupAt!, i18nLocale, timezone)}</span>
                    <StatusBadge kind="load" value={row.load.status} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
