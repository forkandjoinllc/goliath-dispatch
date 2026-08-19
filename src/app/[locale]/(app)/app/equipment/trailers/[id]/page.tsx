import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { getTenantPolicy, requireActor } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { can } from '@/lib/permissions'
import { getEquipmentDetail, getEquipmentResourceContext, listEquipmentAuditHistory } from '@/server/equipment/queries'
import { equipmentMediaDownloadUrl } from '@/server/equipment/service'
import { EquipmentDetailView } from '../../_components/equipment-detail-view'

export default async function TrailerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const resource = await getEquipmentResourceContext(tenantDb(actorPreview.tenantId), 'trailer', id)
  const ctx = await loadFor('equipment:read', resource)
  const detail = await getEquipmentDetail(ctx.db, 'trailer', id)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const permissions = {
    canEdit: can(ctx.actor, 'equipment:update', resource, policy).allowed,
    canManageStatus: can(ctx.actor, 'equipment:status:update', resource, policy).allowed,
    canUploadMedia: can(ctx.actor, 'equipment:media:upload', resource, policy).allowed,
    canOverride: can(ctx.actor, 'equipment:verification:override', resource, policy).allowed,
  }

  const [mediaItems, history] = await Promise.all([
    Promise.all(detail.media.map(async (media) => ({ media, url: await equipmentMediaDownloadUrl(media) }))),
    listEquipmentAuditHistory(ctx.db, 'trailer', id),
  ])

  return (
    <EquipmentDetailView
      locale={locale}
      equipmentType="trailer"
      equipment={detail.equipment}
      equipmentTypeLabel={detail.equipmentType?.labelEn ?? null}
      compliance={detail.compliance}
      verification={detail.verification}
      mediaItems={mediaItems}
      missingAngles={detail.missingAngles}
      documents={detail.documents}
      history={history}
      permissions={permissions}
    />
  )
}
