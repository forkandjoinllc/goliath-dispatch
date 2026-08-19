'use client'

import { MapView, type MapWaypoint } from '@/components/data/map-view'
import { StatusBadge } from '@/components/status/status-badge'
import { EmptyState } from '@/components/ui/feedback'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { LoadListRow } from '@/server/loads/queries'
import type { LoadStop } from '@/db/schema'

/** One marker per load, placed at its first pickup stop. */
export function LoadsMapView({
  locale,
  rows,
  stopsByLoadId,
}: {
  locale: string
  rows: LoadListRow[]
  stopsByLoadId: Map<string, LoadStop[]>
}) {
  const t = useTranslate()

  const waypoints: MapWaypoint[] = []
  for (const row of rows) {
    const stops = stopsByLoadId.get(row.load.id) ?? []
    const pickup = stops.find((s) => s.stopType === 'pickup' && s.latitude && s.longitude) ?? stops.find((s) => s.latitude && s.longitude)
    if (!pickup?.latitude || !pickup?.longitude) continue
    waypoints.push({
      id: row.load.id,
      label: row.load.loadNumber,
      subLabel: [row.customerName, row.carrierName].filter(Boolean).join(' · '),
      kind: 'waypoint',
      lat: Number(pickup.latitude),
      lng: Number(pickup.longitude),
    })
  }

  if (waypoints.length === 0) return <EmptyState title={t('load.states.emptyMap')} />

  return (
    <div className="space-y-4">
      <MapView
        waypoints={waypoints}
        labels={{ noProviderNote: t('common.states.comingSoonHint'), schematicCaption: t('load.views.map') }}
        height={420}
      />
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <li key={row.load.id} className="flex items-center justify-between gap-2 rounded-lg border border-steel-200 p-2 text-sm">
            <a href={`/${locale}/app/loads/${row.load.id}`} className="font-semibold text-navy-700 hover:underline">
              {row.load.loadNumber}
            </a>
            <StatusBadge kind="load" value={row.load.status} />
          </li>
        ))}
      </ul>
    </div>
  )
}
