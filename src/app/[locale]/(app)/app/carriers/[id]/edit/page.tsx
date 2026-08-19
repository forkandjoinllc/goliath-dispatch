import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can } from '@/lib/permissions'
import { getCarrier } from '@/server/carriers/queries'
import { PageHeader } from '@/components/shell/page-header'
import { CarrierEditForm } from '../../_components/carrier-edit-form'
import { CarrierDispatchFeeForm } from '../../_components/carrier-dispatch-fee-form'

/** Carrier "edit" screen: company data through `updateCarrierAction`, and the dispatch fee (Admin only) through its own reason-required action. */
export default async function CarrierEditPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('carrier:update', { carrierId: id })
  const carrier = await getCarrier(ctx.db, id)
  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canEditFee = can(ctx.actor, 'carrier:fee:update', { carrierId: id }, policy).allowed

  const dictionary = await getDictionary(locale, ['carrier', 'common'])
  const t = createTranslator(dictionary, locale)

  return (
    <div className="space-y-6">
      <PageHeader title={t('carrier.actions.edit')} description={carrier.legalName} />
      <CarrierEditForm carrier={carrier} locale={locale} />
      {canEditFee ? <CarrierDispatchFeeForm carrier={carrier} locale={locale} /> : null}
    </div>
  )
}
