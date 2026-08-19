'use client'

import { MapView, type MapWaypoint } from '@/components/data/map-view'
import { EmptyState } from '@/components/ui/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'

/**
 * The tracking map card: a stop-by-stop schematic plus the session's last
 * known position, when there is one. Shared between the dedicated tracking
 * detail page (`app/tracking/[loadId]`) and the load detail page's tracking
 * summary (`app/loads/[id]/_components/tracking-tab.tsx`) — both build the
 * same `MapWaypoint[]` shape from a load's stops and its current session.
 */
export function TrackingMapPanel({ waypoints }: { waypoints: MapWaypoint[] }) {
  const t = useTranslate()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tracking.detail.mapTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {waypoints.length === 0 ? (
          <EmptyState title={t('tracking.detail.mapUnavailable')} />
        ) : (
          <MapView
            waypoints={waypoints}
            labels={{
              noProviderNote: t('tracking.detail.mapNoProviderNote'),
              schematicCaption: t('tracking.detail.mapSchematicCaption'),
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}
