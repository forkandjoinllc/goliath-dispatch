'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { Load, TrackingSession } from '@/db/schema'
import type { SessionHealthStatus } from '@/server/tracking/sessions'

const HEALTH_TONE: Record<SessionHealthStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  unknown: 'neutral',
  healthy: 'success',
  stale: 'warning',
  lost: 'danger',
  ended: 'neutral',
}

export interface FleetRow {
  session: TrackingSession
  load: Load
  driverName: string | null
}

export function FleetSessionTable({ rows, localePrefix }: { rows: FleetRow[]; localePrefix: string }) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()

  if (rows.length === 0) {
    return <EmptyState title={t('tracking.fleetView.empty')} />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('tracking.fleetView.loadColumn')}</TableHead>
          <TableHead>{t('tracking.fleetView.driverColumn')}</TableHead>
          <TableHead>{t('tracking.fleetView.statusColumn')}</TableHead>
          <TableHead>{t('tracking.fleetView.healthColumn')}</TableHead>
          <TableHead>{t('tracking.fleetView.etaColumn')}</TableHead>
          <TableHead>{t('tracking.fleetView.progressColumn')}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ session, load, driverName }) => (
          <TableRow key={session.id}>
            <TableCell className="font-medium">{load.loadNumber}</TableCell>
            <TableCell>{driverName ?? '—'}</TableCell>
            <TableCell>{t(`tracking.status.${load.status}`)}</TableCell>
            <TableCell>
              <Badge tone={HEALTH_TONE[session.healthStatus as SessionHealthStatus]}>
                {t(`tracking.health.${session.healthStatus}`)}
              </Badge>
            </TableCell>
            <TableCell>{session.etaAt ? formatDateTime(session.etaAt, locale, timezone) : '—'}</TableCell>
            <TableCell>{session.routeProgressPercent != null ? `${session.routeProgressPercent}%` : '—'}</TableCell>
            <TableCell>
              <Button size="sm" variant="secondary" asChild>
                <Link href={`${localePrefix}/app/tracking/${load.id}`}>
                  {t('tracking.fleetView.viewButton')}
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
