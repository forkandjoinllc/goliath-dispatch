import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { getTenantPolicy, requireActor } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { can } from '@/lib/permissions'
import { getLoadResourceContext } from '@/server/loads/queries'
import { getCurrentEvaluation } from '@/server/oversize/service'
import { listEscortsForLoad, listPermitsForLoad } from '@/server/permits/service'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { and, eq } from 'drizzle-orm'
import { loads, userTenantMemberships, users } from '@/db/schema'
import { fullName } from '@/lib/utils'
import { OversizePanel } from '../../_components/oversize-panel'
import { AddPermitButton, PermitsList } from '../../_components/permits-list'
import { AddEscortButton, EscortsList } from '../../_components/escorts-list'
import { PermitReadyPanel } from '../../_components/permit-ready-panel'

/**
 * Mirrors `compliance/service.ts`'s (unexported) `isEvaluationCurrentForLoad`
 * — duplicated rather than imported since that function isn't exported, and
 * it's small enough that a comment pointing at the source of truth is safer
 * than reaching past the module boundary.
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

export default async function OversizeWorkspacePage({
  params,
}: {
  params: Promise<{ locale: string; loadId: string }>
}) {
  const { locale, loadId } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const resource = await getLoadResourceContext(tenantDb(actorPreview.tenantId), loadId, actorPreview)
  const ctx = await loadFor('permit:read', resource)

  const load = await ctx.db.requireById(loads, loadId, 'load')
  const policy = await getTenantPolicy(ctx.actor.tenantId)

  const permissions = {
    canEvaluate: can(ctx.actor, 'oversize:evaluate', resource, policy).allowed,
    canValidate: can(ctx.actor, 'oversize:validate', resource, policy).allowed,
    canManagePermits: can(ctx.actor, 'permit:manage', resource, policy).allowed,
    canApproveReady: can(ctx.actor, 'permit:approve_ready', resource, policy).allowed,
  }

  const [evaluation, permits, escorts] = await Promise.all([
    getCurrentEvaluation(ctx.db, loadId),
    listPermitsForLoad(ctx.db, loadId),
    listEscortsForLoad(ctx.db, loadId),
  ])

  const dictionary = await getDictionary(locale, ['oversize', 'tracking', 'common', 'errors'])
  const t = createTranslator(dictionary, locale)
  const localePrefix = `/${locale}`

  const isStale = isEvaluationStale(evaluation, load)

  // `users` has no `tenant_id` column (see the identical pattern in
  // `loads/[id]/page.tsx`), so the tenant boundary is proven through a join
  // to `userTenantMemberships` rather than a direct `findById`.
  const approver = load.permitReadyApprovedByUserId
    ? (
        await ctx.db.builderRequiringExplicitTenantPredicate
          .select({ firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .innerJoin(
            userTenantMemberships,
            and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, ctx.db.tenantId)),
          )
          .where(eq(users.id, load.permitReadyApprovedByUserId))
      )[0] ?? null
    : null

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('oversize.evaluation.title')}
        description={load.loadNumber}
        breadcrumb={[
          { label: t('oversize.permits.title'), href: `${localePrefix}/app/permits` },
          { label: load.loadNumber },
        ]}
        LinkComponent={undefined}
      />

      <OversizePanel
        loadId={loadId}
        evaluation={evaluation}
        isStale={isStale}
        canEvaluate={permissions.canEvaluate}
        canValidate={permissions.canValidate}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>{t('oversize.permits.title')}</CardTitle>
          {permissions.canManagePermits ? <AddPermitButton loadId={loadId} /> : null}
        </CardHeader>
        <CardContent>
          <PermitsList
            rows={permits.map((permit) => ({ permit, load }))}
            canManage={permissions.canManagePermits}
            localePrefix={localePrefix}
            showLoadColumn={false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>{t('oversize.escorts.title')}</CardTitle>
          {permissions.canManagePermits ? <AddEscortButton loadId={loadId} /> : null}
        </CardHeader>
        <CardContent>
          <EscortsList
            rows={escorts.map((escort) => ({ escort, load }))}
            canManage={permissions.canManagePermits}
            localePrefix={localePrefix}
            showLoadColumn={false}
          />
        </CardContent>
      </Card>

      <PermitReadyPanel
        loadId={loadId}
        approvedAt={load.permitReadyApprovedAt}
        approvedByLabel={approver ? fullName(approver) : null}
        canApprove={permissions.canApproveReady}
      />
    </div>
  )
}
