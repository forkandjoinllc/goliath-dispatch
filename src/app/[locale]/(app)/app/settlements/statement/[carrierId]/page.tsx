import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { requireActor } from '@/server/context'
import { loadFor } from '@/server/action'
import { carrierStatement } from '@/server/settlements/queries'
import { getCarrier } from '@/server/carriers/queries'
import { CarrierStatementView } from '../../_components/carrier-statement-view'

export default async function CarrierStatementPage({
  params,
}: {
  params: Promise<{ locale: string; carrierId: string }>
}) {
  const { locale, carrierId } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()

  const ctx = await loadFor('settlement:read', { tenantId: actorPreview.tenantId, carrierId })

  const [carrier, entries] = await Promise.all([
    getCarrier(ctx.db, carrierId).catch(() => null),
    carrierStatement(ctx.db, carrierId),
  ])
  if (!carrier) notFound()

  return <CarrierStatementView carrierName={carrier.legalName} entries={entries} />
}
