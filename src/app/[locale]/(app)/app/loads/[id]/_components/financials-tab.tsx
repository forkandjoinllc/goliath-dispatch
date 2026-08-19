'use client'

import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { PermissionDenied } from '@/components/ui/feedback'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatBps, formatDateTime, formatMoney } from '@/i18n/translate'
import type { FinancialSnapshot, Load } from '@/db/schema'

export function FinancialsTab({
  load,
  snapshot,
  canRead,
}: {
  load: Load
  snapshot: FinancialSnapshot | null
  canRead: boolean
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()

  if (!canRead) {
    return <PermissionDenied title={t('load.financials.permissionDenied')} />
  }

  const items: DetailItem[] = [
    { key: 'customerCharge', label: t('load.financials.customerCharge'), value: formatMoney(load.customerChargeCents, locale) },
    { key: 'carrierGrossRate', label: t('load.financials.carrierGrossRate'), value: formatMoney(load.carrierGrossRateCents, locale) },
    { key: 'carrierDispatchFee', label: t('load.financials.carrierDispatchFee'), value: formatBps(load.carrierDispatchFeeBps, locale) },
    { key: 'dispatcherCommission', label: t('load.financials.dispatcherCommission'), value: formatBps(load.dispatcherCommissionBps, locale) },
    {
      key: 'dispatcherCommissionBasis',
      label: t('load.financials.dispatcherCommissionBasis'),
      value: t(`load.financials.commissionBasis.${load.dispatcherCommissionBasis}`),
    },
  ]

  if (!snapshot) {
    return (
      <div className="space-y-6">
        <DetailList items={items} />
        <p className="text-sm text-steel-600">{t('load.financials.noSnapshot')}</p>
      </div>
    )
  }

  const snapshotItems: DetailItem[] = [
    { key: 'commissionableBase', label: t('load.financials.commissionableBase'), value: formatMoney(snapshot.commissionableBaseCents, locale) },
    { key: 'dispatchFeeAmount', label: t('load.financials.dispatchFeeAmount'), value: formatMoney(snapshot.dispatchFeeAmountCents, locale) },
    { key: 'netCarrierSettlement', label: t('load.financials.netCarrierSettlement'), value: formatMoney(snapshot.netCarrierSettlementCents, locale) },
    { key: 'grossMargin', label: t('load.financials.grossMargin'), value: formatMoney(snapshot.grossMarginCents, locale) },
    {
      key: 'dispatcherCommissionAmount',
      label: t('load.financials.dispatcherCommissionAmount'),
      value: formatMoney(snapshot.dispatcherCommissionAmountCents, locale),
    },
  ]

  return (
    <div className="space-y-6">
      <DetailList items={items} />
      <div>
        <h3 className="mb-2 text-base font-bold text-carbon">{t('load.financials.title')}</h3>
        <DetailList items={snapshotItems} />
        <p className="mt-3 text-xs text-steel-600">
          {t('load.financials.version', { version: snapshot.version })} ·{' '}
          {t('load.financials.computedAt', { date: formatDateTime(snapshot.computedAt, locale, timezone) })} ·{' '}
          {snapshot.reason ? t(`load.financials.reason.${snapshot.reason}`) : null}
        </p>
      </div>
    </div>
  )
}
