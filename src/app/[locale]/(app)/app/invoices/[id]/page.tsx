import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { requireActor, getTenantPolicy } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { loadFor } from '@/server/action'
import { can } from '@/lib/permissions'
import { invoices, carriers, loads } from '@/db/schema'
import { getInvoiceDetail } from '@/server/invoices/queries'
import { InvoiceDetailView } from '../_components/invoice-detail-view'

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const previewDb = tenantDb(actorPreview.tenantId)
  const preview = await previewDb.findById(invoices, id)
  if (!preview) notFound()

  const ctx = await loadFor('invoice:read', { tenantId: actorPreview.tenantId, carrierId: preview.carrierId })

  const detail = await getInvoiceDetail(ctx.db, id)
  if (!detail) notFound()

  const [carrier, load] = await Promise.all([
    ctx.db.findById(carriers, detail.invoice.carrierId),
    detail.invoice.loadId ? ctx.db.findById(loads, detail.invoice.loadId) : Promise.resolve(null),
  ])

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const resource = { tenantId: ctx.actor.tenantId, carrierId: detail.invoice.carrierId }
  const permissions = {
    canSend: can(ctx.actor, 'invoice:send', resource, policy).allowed,
    canStatusUpdate: can(ctx.actor, 'invoice:status:update', resource, policy).allowed,
    canRecordPayment: can(ctx.actor, 'payment:record', resource, policy).allowed,
    canRefund: can(ctx.actor, 'payment:refund', resource, policy).allowed,
    canPay: can(ctx.actor, 'invoice:pay', resource, policy).allowed,
  }

  return (
    <InvoiceDetailView
      invoice={detail.invoice}
      lineItems={detail.lineItems}
      payments={detail.payments}
      carrierName={carrier?.legalName ?? '—'}
      loadNumber={load?.loadNumber ?? null}
      permissions={permissions}
    />
  )
}
