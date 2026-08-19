'use client'

import { FileText, Wallet } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { PageHeader } from '@/components/shell/page-header'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate, formatMoney } from '@/i18n/translate'
import { ReceiptLink } from '../../expenses/_components/receipt-link'
import type { CarrierSettlement } from '@/db/schema'
import type { CarrierSettlementLine } from '@/server/settlements/service'
import {
  IssueSettlementButton,
  MarkSettlementPaidButton,
  RecordFactoringSubmissionButton,
  VoidSettlementDialog,
} from './settlement-status-actions'

const STATUS_TONE = { draft: 'neutral', issued: 'info', paid: 'success', voided: 'danger' } as const

export function SettlementDetailView({
  settlement,
  lines,
  carrierName,
  loadNumberByLoadId,
  factoringCompanyName,
  permissions,
}: {
  settlement: CarrierSettlement
  lines: CarrierSettlementLine[]
  carrierName: string
  loadNumberByLoadId: Record<string, string>
  factoringCompanyName: string | null
  permissions: { canManage: boolean }
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()

  const items: DetailItem[] = [
    { key: 'carrier', label: t('finance.settlement.fields.carrier'), value: carrierName },
    { key: 'periodStart', label: t('finance.settlement.fields.periodStart'), value: formatDate(settlement.periodStart, locale, timezone) },
    { key: 'periodEnd', label: t('finance.settlement.fields.periodEnd'), value: formatDate(settlement.periodEnd, locale, timezone) },
    { key: 'grossRate', label: t('finance.settlement.fields.grossRate'), value: formatMoney(settlement.grossRateCents, locale) },
    { key: 'reimbursements', label: t('finance.settlement.fields.reimbursements'), value: formatMoney(settlement.reimbursementsCents, locale) },
    { key: 'dispatchFees', label: t('finance.settlement.fields.dispatchFees'), value: formatMoney(settlement.dispatchFeesCents, locale) },
    { key: 'deductions', label: t('finance.settlement.fields.deductions'), value: formatMoney(settlement.deductionsCents, locale) },
    { key: 'netAmount', label: t('finance.settlement.fields.netAmount'), value: formatMoney(settlement.netAmountCents, locale) },
    ...(settlement.issuedAt
      ? [{ key: 'issuedAt', label: t('finance.settlement.fields.issuedAt'), value: formatDate(settlement.issuedAt, locale, timezone) }]
      : []),
    ...(settlement.paidAt
      ? [{ key: 'paidAt', label: t('finance.settlement.fields.paidAt'), value: formatDate(settlement.paidAt, locale, timezone) }]
      : []),
    ...(factoringCompanyName
      ? [{ key: 'factoringCompany', label: t('finance.settlement.fields.factoringCompany'), value: factoringCompanyName }]
      : []),
    ...(settlement.factoringSubmittedAt
      ? [
          {
            key: 'factoringSubmittedAt',
            label: t('finance.settlement.fields.factoringSubmittedAt'),
            value: formatDate(settlement.factoringSubmittedAt, locale, timezone),
          },
        ]
      : []),
    ...(settlement.notes
      ? [{ key: 'notes', label: t('finance.settlement.fields.notes'), value: settlement.notes, fullWidth: true }]
      : []),
    ...(settlement.pdfDocumentId
      ? [{ key: 'pdf', label: t('finance.settlement.actions.downloadPdf'), value: <ReceiptLink documentId={settlement.pdfDocumentId} /> }]
      : []),
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('finance.settlement.detail.title', { settlementNumber: settlement.settlementNumber })}
        status={
          <Badge tone={STATUS_TONE[settlement.status as keyof typeof STATUS_TONE]}>
            {t(`finance.settlement.status.${settlement.status}`)}
          </Badge>
        }
        secondaryActions={
          permissions.canManage ? (
            <div className="flex flex-wrap gap-2">
              {settlement.status === 'draft' ? <IssueSettlementButton settlementId={settlement.id} /> : null}
              {settlement.status === 'issued' ? <MarkSettlementPaidButton settlementId={settlement.id} /> : null}
              {settlement.status === 'issued' && factoringCompanyName && !settlement.factoringSubmittedAt ? (
                <RecordFactoringSubmissionButton
                  settlementId={settlement.id}
                  factoringCompanyId={settlement.factoringCompanyId!}
                  factoringCompanyName={factoringCompanyName}
                />
              ) : null}
              {settlement.status !== 'voided' && settlement.status !== 'paid' ? (
                <VoidSettlementDialog settlementId={settlement.id} />
              ) : null}
            </div>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="pt-5">
          <DetailList items={items} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('finance.settlement.detail.lines')}</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <EmptyState icon={Wallet} title={t('common.states.empty')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('finance.invoice.fields.load')}</TableHead>
                  <TableHead numeric>{t('finance.settlement.fields.grossRate')}</TableHead>
                  <TableHead numeric>{t('finance.settlement.fields.reimbursements')}</TableHead>
                  <TableHead numeric>{t('finance.settlement.fields.dispatchFees')}</TableHead>
                  <TableHead numeric>{t('finance.settlement.fields.deductions')}</TableHead>
                  <TableHead numeric>{t('finance.settlement.fields.netAmount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <FileText className="size-3.5 text-steel-500" aria-hidden="true" />
                        {line.loadId ? loadNumberByLoadId[line.loadId] ?? line.loadId : (locale === 'es' && line.descriptionEs ? line.descriptionEs : line.descriptionEn)}
                      </span>
                    </TableCell>
                    <TableCell numeric className="tabular">{formatMoney(line.grossRateCents, locale)}</TableCell>
                    <TableCell numeric className="tabular">{formatMoney(line.reimbursementsCents, locale)}</TableCell>
                    <TableCell numeric className="tabular">{formatMoney(line.dispatchFeeCents, locale)}</TableCell>
                    <TableCell numeric className="tabular">{formatMoney(line.deductionsCents, locale)}</TableCell>
                    <TableCell numeric className="tabular font-semibold">{formatMoney(line.netCents, locale)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
