import { notFound } from 'next/navigation'
import { inArray } from 'drizzle-orm'
import { isLocale } from '@/i18n/config'
import { requireActor, getTenantPolicy } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { loadFor } from '@/server/action'
import { can } from '@/lib/permissions'
import { carrierSettlements, carriers, loads, factoringCompanies } from '@/db/schema'
import { getSettlementDetail } from '@/server/settlements/queries'
import { SettlementDetailView } from '../_components/settlement-detail-view'

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const previewDb = tenantDb(actorPreview.tenantId)
  const preview = await previewDb.findById(carrierSettlements, id)
  if (!preview) notFound()

  const ctx = await loadFor('settlement:read', { tenantId: actorPreview.tenantId, carrierId: preview.carrierId })

  const detail = await getSettlementDetail(ctx.db, id)
  if (!detail) notFound()

  const [carrier, factoringCompany] = await Promise.all([
    ctx.db.findById(carriers, detail.settlement.carrierId),
    detail.settlement.factoringCompanyId
      ? ctx.db.findById(factoringCompanies, detail.settlement.factoringCompanyId)
      : Promise.resolve(null),
  ])

  const loadIds = [...new Set(detail.lines.map((l) => l.loadId).filter((v): v is string => Boolean(v)))]
  const relevantLoads =
    loadIds.length > 0 ? await ctx.db.findMany(loads, { where: inArray(loads.id, loadIds) }) : []

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canManage = can(
    ctx.actor,
    'settlement:manage',
    { tenantId: ctx.actor.tenantId, carrierId: detail.settlement.carrierId },
    policy,
  ).allowed

  return (
    <SettlementDetailView
      settlement={detail.settlement}
      lines={detail.lines}
      carrierName={carrier?.legalName ?? '—'}
      loadNumberByLoadId={Object.fromEntries(relevantLoads.map((l) => [l.id, l.loadNumber]))}
      factoringCompanyName={factoringCompany?.name ?? null}
      permissions={{ canManage }}
    />
  )
}
