'use client'

import * as React from 'react'
import { differenceInCalendarDays } from 'date-fns'
import { AlertTriangle, CalendarClock, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/components/providers/i18n-provider'
import { formatDate } from '@/i18n/translate'

/**
 * Renders "expires in 12 days" / "expires today" / "expired 3 days ago" with
 * a tone that escalates as the date approaches or passes.
 */
export function ExpiryBadge({
  date,
  warningDays = 30,
  className,
}: {
  date: Date | string | null | undefined
  warningDays?: number
  className?: string
}) {
  const { t, locale, timezone } = useI18n()

  if (!date) {
    return (
      <Badge tone="neutral" className={className}>
        {t('common.labels.none')}
      </Badge>
    )
  }

  const target = typeof date === 'string' ? new Date(date) : date
  const days = differenceInCalendarDays(target, new Date())
  const title = formatDate(target, locale, timezone)

  if (days < 0) {
    return (
      <Badge tone="danger" className={className} title={title}>
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        {t('nav.status.expiry.expiredAgo', { days: Math.abs(days) })}
      </Badge>
    )
  }

  if (days === 0) {
    return (
      <Badge tone="danger" className={className} title={title}>
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        {t('nav.status.expiry.expiresToday')}
      </Badge>
    )
  }

  if (days <= warningDays) {
    return (
      <Badge tone="warning" className={className} title={title}>
        <CalendarClock className="size-3.5" aria-hidden="true" />
        {t('nav.status.expiry.expiresIn', { days })}
      </Badge>
    )
  }

  return (
    <Badge tone="success" className={className} title={title}>
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      {t('nav.status.expiry.expiresIn', { days })}
    </Badge>
  )
}
