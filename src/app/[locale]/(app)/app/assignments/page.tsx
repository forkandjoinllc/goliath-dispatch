import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can } from '@/lib/permissions'
import { trailers, trucks, drivers, dispatcherGroups } from '@/db/schema'
import { listCarriers } from '@/server/carriers/queries'
import {
  assignmentHistoryForCarrier,
  dispatcherCarrierMatrix,
  dispatcherReach,
  listDispatcherResourceGrants,
  listDispatcherUsers,
  listGroupsWithDetail,
} from '@/server/assignments/queries'
import type { DispatcherResourceAssignment } from '@/server/assignments/service'
import { PageHeader } from '@/components/shell/page-header'
import { PermissionDenied } from '@/components/ui/feedback'
import { AssignmentsTabs } from './_components/assignments-tabs'

async function resolveResourceLabel(
  ctx: Awaited<ReturnType<typeof loadFor>>,
  grant: DispatcherResourceAssignment,
): Promise<string> {
  switch (grant.resourceType) {
    case 'truck': {
      const row = await ctx.db.findById(trucks, grant.resourceId)
      return row ? row.unitNumber : grant.resourceId
    }
    case 'trailer': {
      const row = await ctx.db.findById(trailers, grant.resourceId)
      return row ? row.unitNumber : grant.resourceId
    }
    case 'driver': {
      const row = await ctx.db.findById(drivers, grant.resourceId)
      return row ? `${row.firstName} ${row.lastName}` : grant.resourceId
    }
    case 'group': {
      const row = await ctx.db.findById(dispatcherGroups, grant.resourceId)
      return row ? row.name : grant.resourceId
    }
    default:
      return grant.resourceId
  }
}

export default async function AssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ carrierId?: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const { carrierId } = await searchParams

  const ctx = await loadFor('assignment:read')
  const dictionary = await getDictionary(locale, ['assignment', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canManage = can(ctx.actor, 'assignment:manage', undefined, policy).allowed

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('assignment.title')} />
        <PermissionDenied title={t('assignment.permissionDenied.title')} description={t('assignment.permissionDenied.description')} />
      </div>
    )
  }

  const [matrix, groups, dispatchers, { carriers }] = await Promise.all([
    dispatcherCarrierMatrix(ctx.db),
    listGroupsWithDetail(ctx.db, true),
    listDispatcherUsers(ctx.db),
    listCarriers(ctx.db, { kind: 'tenant', tenantId: ctx.actor.tenantId }, { pagination: { page: 1, pageSize: 200 } }),
  ])

  const reachByDispatcher = await Promise.all(
    dispatchers.map(async (d) => ({ userId: d.userId, name: d.name, reach: await dispatcherReach(ctx.db, d.userId) })),
  )

  const grantRows = (
    await Promise.all(dispatchers.map((d) => listDispatcherResourceGrants(ctx.db, d.userId)))
  ).flat()
  const grants = await Promise.all(
    grantRows.map(async (grant) => ({
      grant,
      dispatcherName: dispatchers.find((d) => d.userId === grant.dispatcherUserId)?.name ?? grant.dispatcherUserId,
      resourceLabel: await resolveResourceLabel(ctx, grant),
    })),
  )

  const history = carrierId ? await assignmentHistoryForCarrier(ctx.db, carrierId) : []

  return (
    <div className="space-y-6">
      <PageHeader title={t('assignment.title')} />
      <AssignmentsTabs
        matrix={matrix}
        reachByDispatcher={reachByDispatcher}
        groups={groups}
        grants={grants}
        dispatcherOptions={dispatchers}
        carrierOptions={carriers.map((c) => ({ value: c.id, label: c.legalName }))}
        selectedCarrierId={carrierId ?? ''}
        history={history}
      />
    </div>
  )
}
