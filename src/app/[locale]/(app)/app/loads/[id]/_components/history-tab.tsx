'use client'

import { Timeline, type TimelineEvent } from '@/components/data/timeline'
import { EmptyState } from '@/components/ui/feedback'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { LoadStatusHistoryRow } from '@/db/schema'

function statusI18nKey(status: string): string {
  return status.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

export function HistoryTab({
  statusHistory,
  actorLabels,
}: {
  statusHistory: LoadStatusHistoryRow[]
  actorLabels: Record<string, string>
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()

  if (statusHistory.length === 0) return <EmptyState title={t('load.history.empty')} />

  const ordered = [...statusHistory].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

  const events: TimelineEvent[] = ordered.map((entry) => {
    const from = entry.fromStatus ? t(`nav.status.load.${statusI18nKey(entry.fromStatus)}`) : null
    const to = t(`nav.status.load.${statusI18nKey(entry.toStatus)}`)
    const actor = entry.actorUserId ? actorLabels[entry.actorUserId] ?? entry.actorUserId : null
    return {
      id: entry.id,
      time: formatDateTime(entry.occurredAt, locale, timezone),
      actor: entry.source === 'user' && actor ? t('load.history.source.user', { actor }) : t(`load.history.source.${entry.source}`),
      tone: entry.toStatus === 'cancelled' ? 'danger' : entry.toStatus === 'delivered' || entry.toStatus === 'paid' ? 'success' : 'neutral',
      description: from ? t('load.history.entry', { from, to }) : t('load.history.entryFromNone', { to }),
    }
  })

  return <Timeline events={events} />
}
