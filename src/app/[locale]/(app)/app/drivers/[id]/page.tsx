import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { getTenantPolicy, requireActor } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { can, scopeFilter } from '@/lib/permissions'
import { userTenantMemberships, users } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { fullName } from '@/lib/utils'
import { getDriverDetail, getDriverPortalAccess, getDriverResourceContext, listDriverAuditHistory } from '@/server/drivers/queries'
import { listCarriers } from '@/server/carriers/queries'
import { DriverDetailView } from '../_components/driver-detail-view'

export default async function DriverDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const resource = await getDriverResourceContext(tenantDb(actorPreview.tenantId), id, actorPreview.carrierId)
  const ctx = await loadFor('driver:read', resource)

  const [detail, history, portalAccess] = await Promise.all([
    getDriverDetail(ctx.db, id),
    listDriverAuditHistory(ctx.db, id),
    getDriverPortalAccess(ctx.db, id),
  ])

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const permissions = {
    canEdit: can(ctx.actor, 'driver:update', resource, policy).allowed,
    canManageStatus: can(ctx.actor, 'driver:update', resource, policy).allowed,
    canManageRelationships: can(ctx.actor, 'driver:update', resource, policy).allowed,
    canApprove: can(ctx.actor, 'driver:approve', resource, policy).allowed,
    canInvitePortalUser: can(ctx.actor, 'tenant:user:invite', resource, policy).allowed,
    canManagePortalLink: can(ctx.actor, 'driver:update', resource, policy).allowed,
    canUpload: can(ctx.actor, 'document:upload', resource, policy).allowed,
  }

  let availableCarriers: { value: string; label: string }[] = []
  if (permissions.canManageRelationships) {
    const carrierScope = scopeFilter(ctx.actor, can(ctx.actor, 'carrier:read', undefined, policy).scope ?? 'own')
    const { carriers } = await listCarriers(ctx.db, carrierScope, { pagination: { page: 1, pageSize: 200 } })
    const alreadyLinked = new Set(detail.carrierRelationships.map((r) => r.carrier.id))
    availableCarriers = carriers.filter((c) => !alreadyLinked.has(c.id)).map((c) => ({ value: c.id, label: c.legalName }))
  }

  let reviewerName: string | null = null
  if (detail.driver.verifiedByUserId) {
    // `users` has no `tenant_id` column — see the identical pattern (and
    // comment) in `carriers/queries.ts` for why the tenant boundary is
    // proven through a join to `userTenantMemberships` instead.
    const [reviewer] = await ctx.db.builderRequiringExplicitTenantPredicate
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .innerJoin(
        userTenantMemberships,
        and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, ctx.db.tenantId)),
      )
      .where(eq(users.id, detail.driver.verifiedByUserId))
    reviewerName = reviewer ? fullName(reviewer) : null
  }

  return (
    <DriverDetailView
      driver={detail.driver}
      relationships={detail.carrierRelationships}
      availableCarriers={availableCarriers}
      reviewerName={reviewerName}
      documents={detail.documents}
      history={history}
      portalAccess={portalAccess}
      permissions={permissions}
      editHref={`/${locale}/app/drivers/${id}/edit`}
    />
  )
}
