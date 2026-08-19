'use client'

import { Timeline, type TimelineEvent } from '@/components/data/timeline'
import { EmptyState } from '@/components/ui/feedback'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { LoadListRow } from '@/server/loads/queries'
import type { LoadStop } from '@/db/schema'

/**
 * A chronological feed of every stop window across the filtered loads —
 * the fleet's schedule read as a single timeline rather than table row per
 * load. Past/current/future windows are toned so a glance shows what has
 * already happened.
 */
export function LoadsTimelineView({
  locale,
  rows,
  stopsByLoadId,
}: {
  locale: string
  rows: LoadListRow[]
  stopsByLoadId: Map<string, LoadStop[]>
}) {
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const rowByLoadId = new Map(rows.map((row) => [row.load.id, row]))

  const entries: Array<{ stop: LoadStop; row: LoadListRow }> = []
  for (const [loadId, stops] of stopsByLoadId) {
    const row = rowByLoadId.get(loadId)
    if (!row) continue
    for (const stop of stops) {
      if (stop.windowStart) entries.push({ stop, row })
    }
  }
  entries.sort((a, b) => a.stop.windowStart!.getTime() - b.stop.windowStart!.getTime())

  if (entries.length === 0) return <EmptyState title={t('load.states.emptyTimeline')} />

  const now = Date.now()
  const events: TimelineEvent[] = entries.map(({ stop, row }) => {
    const isPast = stop.windowEnd ? stop.windowEnd.getTime() < now : stop.windowStart!.getTime() < now
    const location = [stop.city, stop.state].filter(Boolean).join(', ') || t('common.labels.none')
    return {
      id: stop.id,
      time: formatDateTime(stop.windowStart!, i18nLocale, timezone),
      actor: row.load.loadNumber,
      tone: isPast ? 'neutral' : stop.stopType === 'pickup' ? 'success' : 'warning',
      description: (
        <a href={`/${locale}/app/loads/${row.load.id}`} className="hover:underline">
          {t(`load.stopTypes.${stop.stopType}`)} — {location} ({row.customerName})
        </a>
      ),
    }
  })

  return <Timeline events={events} />
}
