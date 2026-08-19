'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { AuditEvent } from '@/db/schema'

export interface AuditEventTimelineProps {
  events: AuditEvent[]
  emptyLabel: string
}

/**
 * Readable rendering of a set of related audit events — reused by the
 * request-id grouped view and the impersonation-session detail view. Purely
 * a read-only presentation of what `listEventsByRequestId` /
 * `listEventsForImpersonationSession` returned; there is no action here that
 * could mutate an event, matching `audit_events` being append-only at the
 * database level.
 */
export function AuditEventTimeline({ events, emptyLabel }: AuditEventTimelineProps) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()

  if (events.length === 0) return <EmptyState title={emptyLabel} />

  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id}>
          <Card>
            <CardContent className="space-y-2 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-carbon">{event.action}</span>
                  {event.reason ? <Badge tone="warning">{t('report.audit.reasonBadge')}</Badge> : null}
                </div>
                <span className="text-xs text-steel-500">{formatDateTime(event.occurredAt, locale, timezone)}</span>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-steel-700">
                <span>
                  <span className="text-steel-500">{t('report.audit.columns.actor')}: </span>
                  {event.actorEmail ?? t('report.values.system')}
                  {event.actorRole ? ` (${event.actorRole})` : ''}
                </span>
                {event.entityType ? (
                  <span>
                    <span className="text-steel-500">{t('report.audit.columns.entity')}: </span>
                    {event.entityType}
                    {event.entityLabel ? ` · ${event.entityLabel}` : ''}
                  </span>
                ) : null}
                {event.requestId ? (
                  <span>
                    <span className="text-steel-500">{t('report.audit.columns.requestId')}: </span>
                    <span className="font-mono">{event.requestId}</span>
                  </span>
                ) : null}
              </div>

              {event.reason ? <p className="text-sm text-carbon">{event.reason}</p> : null}

              {event.beforeSummary || event.afterSummary ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {event.beforeSummary ? (
                    <div className="rounded-md bg-steel-50 p-2">
                      <p className="text-xs font-semibold uppercase text-steel-500">{t('report.audit.before')}</p>
                      <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-steel-700">
                        {JSON.stringify(event.beforeSummary, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                  {event.afterSummary ? (
                    <div className="rounded-md bg-navy-50 p-2">
                      <p className="text-xs font-semibold uppercase text-navy-600">{t('report.audit.after')}</p>
                      <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-navy-800">
                        {JSON.stringify(event.afterSummary, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  )
}
