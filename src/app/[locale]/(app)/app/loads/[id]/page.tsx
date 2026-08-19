import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { getTenantPolicy, requireActor } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { can } from '@/lib/permissions'
import { getLoadDetail, getLoadResourceContext } from '@/server/loads/queries'
import { getSessionForLoad } from '@/server/tracking/sessions'
import { getCurrentEvaluation } from '@/server/oversize/service'
import { and, eq, inArray } from 'drizzle-orm'
import { drivers, loads, trailers, trucks, userTenantMemberships, users } from '@/db/schema'
import { fullName } from '@/lib/utils'
import type { MapWaypoint } from '@/components/data/map-view'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { LoadDetailView } from './_components/load-detail-view'

/**
 * Mirrors `compliance/service.ts`'s (unexported) `isEvaluationCurrentForLoad`
 * — the same duplication `app/permits/oversize/[loadId]/page.tsx` already
 * carries, with the same comment: that function isn't exported, and it's
 * small enough that pointing at the source of truth is safer than reaching
 * past the module boundary.
 */
function isEvaluationStale(
  evaluation: { inputs: Record<string, unknown> } | null,
  load: { weightPounds: number | null; lengthInches: number | null; widthInches: number | null; heightInches: number | null },
): boolean {
  if (!evaluation) return false
  const inputs = evaluation.inputs
  return !(
    inputs.weightPounds === load.weightPounds &&
    inputs.lengthInches === load.lengthInches &&
    inputs.widthInches === load.widthInches &&
    inputs.heightInches === load.heightInches
  )
}

export default async function LoadDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const resource = await getLoadResourceContext(tenantDb(actorPreview.tenantId), id, actorPreview)
  const ctx = await loadFor('load:read', resource)

  const detail = await getLoadDetail(ctx.db, id)
  const policy = await getTenantPolicy(ctx.actor.tenantId)

  const permissions = {
    canUpdate: can(ctx.actor, 'load:update', resource, policy).allowed,
    canAssignCarrier: can(ctx.actor, 'load:assign_carrier', resource, policy).allowed,
    canAssignResources: can(ctx.actor, 'load:assign_resources', resource, policy).allowed,
    canChangeStatus: can(ctx.actor, 'load:status:update', resource, policy).allowed,
    canCancel: can(ctx.actor, 'load:cancel', resource, policy).allowed,
    canDuplicate: can(ctx.actor, 'load:duplicate', resource, policy).allowed,
    canReadFinancials: can(ctx.actor, 'load:financials:read', resource, policy).allowed,
    canUpdateFinancials: can(ctx.actor, 'load:financials:update', resource, policy).allowed,
    canUploadDocuments: can(ctx.actor, 'load:document:upload', resource, policy).allowed,
    canReviewDocuments: can(ctx.actor, 'document:review', resource, policy).allowed,
    canRespondToRateConfirmation: can(ctx.actor, 'load:rateconf:respond', resource, policy).allowed,
    canEvaluateOversize: can(ctx.actor, 'oversize:evaluate', resource, policy).allowed,
    canValidateOversize: can(ctx.actor, 'oversize:validate', resource, policy).allowed,
  }

  const [oversizeEvaluation, trackingSession] = await Promise.all([
    getCurrentEvaluation(ctx.db, id),
    getSessionForLoad(ctx.db, id),
  ])
  const oversizeIsStale = isEvaluationStale(oversizeEvaluation, detail.load)

  const trackingDictionary = await getDictionary(locale, ['tracking'])
  const trackingT = createTranslator(trackingDictionary, locale)
  const orderedStops = detail.stops.slice().sort((a, b) => a.sequence - b.sequence)
  const trackingWaypoints: MapWaypoint[] = orderedStops.map((stop) => ({
    id: stop.id,
    label: [stop.city, stop.state].filter(Boolean).join(', ') || stop.facilityName || trackingT('tracking.route.title'),
    kind: stop.stopType === 'pickup' ? 'pickup' : 'delivery',
    lat: stop.latitude != null ? Number(stop.latitude) : undefined,
    lng: stop.longitude != null ? Number(stop.longitude) : undefined,
  }))
  if (trackingSession?.lastLatitude && trackingSession?.lastLongitude) {
    trackingWaypoints.push({
      id: 'current-position',
      label: trackingSession.lastLocationLabel ?? trackingT('tracking.session.lastPosition'),
      kind: 'waypoint',
      lat: Number(trackingSession.lastLatitude),
      lng: Number(trackingSession.lastLongitude),
    })
  }

  const duplicatedFromLoadNumber = detail.load.duplicatedFromLoadId
    ? (await ctx.db.findById(loads, detail.load.duplicatedFromLoadId))?.loadNumber ?? null
    : null

  const truckIds = [...new Set(detail.assignments.map((a) => a.truckId).filter((v): v is string => Boolean(v)))]
  const trailerIds = [...new Set(detail.assignments.map((a) => a.trailerId).filter((v): v is string => Boolean(v)))]
  const driverIds = [...new Set(detail.assignments.map((a) => a.driverId).filter((v): v is string => Boolean(v)))]
  const [truckRows, trailerRows, driverRows] = await Promise.all([
    truckIds.length > 0 ? ctx.db.findMany(trucks, { where: inArray(trucks.id, truckIds) }) : Promise.resolve([]),
    trailerIds.length > 0 ? ctx.db.findMany(trailers, { where: inArray(trailers.id, trailerIds) }) : Promise.resolve([]),
    driverIds.length > 0 ? ctx.db.findMany(drivers, { where: inArray(drivers.id, driverIds) }) : Promise.resolve([]),
  ])
  const resourceLabels: Record<string, string> = {}
  for (const truck of truckRows) resourceLabels[truck.id] = truck.unitNumber
  for (const trailer of trailerRows) resourceLabels[trailer.id] = trailer.unitNumber
  for (const driver of driverRows) resourceLabels[driver.id] = fullName(driver)

  // `users` has no `tenant_id` column (see the identical pattern and comment
  // in `carriers/queries.ts`), so the tenant boundary is proven through a
  // join to `userTenantMemberships` rather than a direct `findMany`.
  const userIds = [
    ...new Set([
      ...detail.rateConfirmationDecisions.map((d) => d.actorUserId),
      ...detail.statusHistory.map((h) => h.actorUserId).filter((v): v is string => Boolean(v)),
      ...detail.checkCalls.map((c) => c.completedByUserId).filter((v): v is string => Boolean(v)),
      ...detail.documentReviews.map((r) => r.reviewerUserId),
    ]),
  ]
  const userRows =
    userIds.length > 0
      ? await ctx.db.builderRequiringExplicitTenantPredicate
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .innerJoin(userTenantMemberships, and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, ctx.db.tenantId)))
          .where(inArray(users.id, userIds))
      : []
  const userLabels: Record<string, string> = {}
  for (const user of userRows) userLabels[user.id] = fullName(user)

  return (
    <LoadDetailView
      locale={locale}
      detail={detail}
      permissions={permissions}
      duplicatedFromLoadNumber={duplicatedFromLoadNumber}
      resourceLabels={resourceLabels}
      userLabels={userLabels}
      oversize={{ evaluation: oversizeEvaluation, isStale: oversizeIsStale }}
      tracking={{
        session: trackingSession
          ? {
              id: trackingSession.id,
              provider: trackingSession.provider,
              driverId: trackingSession.driverId,
              healthStatus: trackingSession.healthStatus as never,
              lastEventAt: trackingSession.lastEventAt,
              lastLocationLabel: trackingSession.lastLocationLabel,
              routeProgressPercent: trackingSession.routeProgressPercent,
              remainingMiles: trackingSession.remainingMiles,
              etaAt: trackingSession.etaAt,
              startedAt: trackingSession.startedAt,
              endedAt: trackingSession.endedAt,
            }
          : null,
        waypoints: trackingWaypoints,
      }}
    />
  )
}
