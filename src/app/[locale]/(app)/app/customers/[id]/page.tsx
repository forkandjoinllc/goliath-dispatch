import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can } from '@/lib/permissions'
import { getCustomerDetail } from '@/server/customers/queries'
import { CustomerDetailView } from '../_components/customer-detail-view'

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('customer:read')
  const detail = await getCustomerDetail(ctx.db, id)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const permissions = {
    canEdit: can(ctx.actor, 'customer:update', { tenantId: ctx.actor.tenantId }, policy).allowed,
    canDelete: can(ctx.actor, 'customer:delete', { tenantId: ctx.actor.tenantId }, policy).allowed,
  }

  return (
    <CustomerDetailView
      locale={locale}
      customer={detail.customer}
      contacts={detail.contacts}
      locations={detail.locations}
      recentLoads={detail.recentLoads}
      receivables={detail.receivables}
      permissions={permissions}
    />
  )
}
