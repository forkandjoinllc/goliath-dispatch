import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { requireActor, getTenantPolicy } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { loadFor } from '@/server/action'
import { can } from '@/lib/permissions'
import { carriers, factoringAssignments } from '@/db/schema'
import { getFactoringAssignmentDetail } from '@/server/factoring/queries'
import { AssignmentDetailView } from '../../_components/assignment-detail-view'

export default async function FactoringAssignmentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const previewDb = tenantDb(actorPreview.tenantId)
  const preview = await previewDb.findById(factoringAssignments, id)
  if (!preview) notFound()

  const ctx = await loadFor('factoring:read', { tenantId: actorPreview.tenantId, carrierId: preview.carrierId })

  const detail = await getFactoringAssignmentDetail(ctx.db, id)
  if (!detail) notFound()

  const carrier = await ctx.db.findById(carriers, detail.assignment.carrierId)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canManage = can(
    ctx.actor,
    'factoring:manage',
    { tenantId: ctx.actor.tenantId, carrierId: detail.assignment.carrierId },
    policy,
  ).allowed

  return (
    <AssignmentDetailView
      assignment={detail.assignment}
      company={detail.company}
      carrierName={carrier?.legalName ?? '—'}
      noticeOfAssignmentDocument={detail.noticeOfAssignmentDocument}
      changeOfPayeeDocument={detail.changeOfPayeeDocument}
      canManage={canManage}
    />
  )
}
