import { notFound } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { getTenantPolicy, requireActor } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { can } from '@/lib/permissions'
import { publicEnv, serverEnv } from '@/lib/env'
import { getLoadResourceContext } from '@/server/loads/queries'
import { currentRoute } from '@/server/routes/service'
import { getSessionForLoad, listSessionEvents } from '@/server/tracking'
import { listPublicTrackingLinksForLoad } from '@/server/tracking/public-links'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/i18n/translate'
import { loadAssignments, loadStops, loads } from '@/db/schema'
import type { MapWaypoint } from '@/components/data/map-view'
import { TrackingMapPanel } from '@/components/data/tracking-map-panel'
import { SessionControlPanel } from './_components/session-control-panel'
import { EventTimeline } from './_components/event-timeline'
import { PublicLinkPanel } from './_components/public-link-panel'

export default async function TrackingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; loadId: string }>
}) {
  const { locale, loadId } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const resource = await getLoadResourceContext(tenantDb(actorPreview.tenantId), loadId, actorPreview)
  const ctx = await loadFor('tracking:read', resource)

  const load = await ctx.db.requireById(loads, loadId, 'load')
  const policy = await getTenantPolicy(ctx.actor.tenantId)

  const permissions = {
    canManage: can(ctx.actor, 'tracking:manage', resource, policy).allowed,
    canCreateLink: can(ctx.actor, 'tracking:link:create', resource, policy).allowed,
    canRevokeLink: can(ctx.actor, 'tracking:link:revoke', resource, policy).allowed,
  }

  const [session, route, links, primaryDriverAssignment, stops] = await Promise.all([
    getSessionForLoad(ctx.db, loadId),
    currentRoute(ctx.db, loadId),
    listPublicTrackingLinksForLoad(ctx.db, loadId),
    ctx.db.findFirst(loadAssignments, {
      where: and(
        eq(loadAssignments.loadId, loadId),
        eq(loadAssignments.resourceType, 'driver'),
        isNull(loadAssignments.unassignedAt),
      )!,
    }),
    ctx.db.findMany(loadStops, { where: eq(loadStops.loadId, loadId) }),
  ])

  const events = session ? await listSessionEvents(ctx.db, session.id) : []

  const dictionary = await getDictionary(locale, ['tracking', 'common', 'errors'])
  const t = createTranslator(dictionary, locale)

  const orderedStops = stops.slice().sort((a, b) => a.sequence - b.sequence)
  const waypoints: MapWaypoint[] = orderedStops.map((stop) => ({
    id: stop.id,
    label: [stop.city, stop.state].filter(Boolean).join(', ') || stop.facilityName || t('tracking.route.title'),
    kind: stop.stopType === 'pickup' ? 'pickup' : 'delivery',
    lat: stop.latitude != null ? Number(stop.latitude) : undefined,
    lng: stop.longitude != null ? Number(stop.longitude) : undefined,
  }))
  if (session?.lastLatitude && session?.lastLongitude) {
    waypoints.push({
      id: 'current-position',
      label: session.lastLocationLabel ?? t('tracking.session.lastPosition'),
      kind: 'waypoint',
      lat: Number(session.lastLatitude),
      lng: Number(session.lastLongitude),
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('tracking.detail.title')}
        description={load.loadNumber}
        breadcrumb={[{ label: t('tracking.fleetView.title'), href: `/${locale}/app/tracking` }, { label: load.loadNumber }]}
      />

      {route ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('tracking.route.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4 text-sm text-steel-700">
            <span>{t('tracking.route.totalMiles', { miles: route.route.totalMiles ?? 0 })}</span>
            <span>
              {t('tracking.route.estimatedDuration', {
                hours: Math.floor((route.route.estimatedDurationMinutes ?? 0) / 60),
                minutes: (route.route.estimatedDurationMinutes ?? 0) % 60,
              })}
            </span>
            <span>
              {route.route.estimatedTollCents != null
                ? t('tracking.route.estimatedToll', { amount: formatMoney(route.route.estimatedTollCents, locale) })
                : t('tracking.route.tollUnavailable')}
            </span>
            <span>{t('tracking.route.statesUsed')}: {route.states.map((s) => s.stateCode).join(', ') || '—'}</span>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <SessionControlPanel
          loadId={loadId}
          session={
            session
              ? {
                  id: session.id,
                  provider: session.provider,
                  driverId: session.driverId,
                  startedAt: session.startedAt,
                  endedAt: session.endedAt,
                  healthStatus: session.healthStatus as never,
                  lastEventAt: session.lastEventAt,
                  lastLocationLabel: session.lastLocationLabel,
                  routeProgressPercent: session.routeProgressPercent,
                  remainingMiles: session.remainingMiles,
                  etaAt: session.etaAt,
                }
              : null
          }
          driverIdHint={primaryDriverAssignment?.driverId ?? null}
          canManage={permissions.canManage}
          isMockProvider={serverEnv().TRACKING_DEFAULT_PROVIDER === 'mock'}
        />
        <TrackingMapPanel waypoints={waypoints} />
      </div>

      <EventTimeline events={events} />

      <PublicLinkPanel
        loadId={loadId}
        links={links}
        publicOrigin={publicEnv.NEXT_PUBLIC_APP_URL}
        canCreate={permissions.canCreateLink}
        canRevoke={permissions.canRevokeLink}
      />
    </div>
  )
}
