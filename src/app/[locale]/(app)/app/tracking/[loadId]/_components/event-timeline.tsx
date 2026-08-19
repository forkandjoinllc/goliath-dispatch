'use client'

import { EmptyState } from '@/components/ui/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { TrackingEvent } from '@/db/schema'

export function EventTimeline({ events }: { events: TrackingEvent[] }) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tracking.detail.timelineTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState title={t('tracking.detail.timelineEmpty')} />
        ) : (
          <ol className="space-y-3 border-l border-steel-200 pl-4">
            {events.map((event) => (
              <li key={event.id} className="relative">
                <span className="absolute -left-[21px] top-1 grid size-3 place-items-center rounded-full bg-navy-500" />
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-carbon">{t(`tracking.event.${event.eventType}`)}</span>
                  <span className="text-xs text-steel-500">{formatDateTime(event.occurredAt, locale, timezone)}</span>
                </div>
                {event.locationLabel ? <p className="text-xs text-steel-600">{event.locationLabel}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
