'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/status/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/feedback'
import { Receipt } from 'lucide-react'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate, formatDateTime, formatMoney } from '@/i18n/translate'
import type { Invoice, InvoiceLineItem, Payment } from '@/db/schema'
import { SendInvoiceButton } from './send-invoice-button'
import { RecordPaymentDialog } from './record-payment-dialog'
import { RefundDialog } from './refund-dialog'
import { StatusTransitionDialog } from './status-transition-dialog'
import { PayNowPanel } from './pay-now-panel'

const PAYMENT_STATUS_TONE = {
  pending: 'neutral',
  processing: 'info',
  succeeded: 'success',
  failed: 'danger',
  refunded: 'neutral',
  partially_refunded: 'warning',
  disputed: 'danger',
  cancelled: 'neutral',
} as const

export function InvoiceDetailView({
  invoice,
  lineItems,
  payments,
  carrierName,
  loadNumber,
  permissions,
}: {
  invoice: Invoice
  lineItems: InvoiceLineItem[]
  payments: Payment[]
  carrierName: string
  loadNumber: string | null
  permissions: {
    canSend: boolean
    canStatusUpdate: boolean
    canRecordPayment: boolean
    canRefund: boolean
    canPay: boolean
  }
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()

  const items: DetailItem[] = [
    { key: 'carrier', label: t('finance.invoice.fields.carrier'), value: carrierName },
    { key: 'load', label: t('finance.invoice.fields.load'), value: loadNumber ?? '—' },
    { key: 'subtotal', label: t('finance.invoice.fields.subtotal'), value: formatMoney(invoice.subtotalCents, locale) },
    {
      key: 'adjustments',
      label: t('finance.invoice.fields.adjustments'),
      value: formatMoney(invoice.adjustmentsCents, locale),
    },
    { key: 'total', label: t('finance.invoice.fields.total'), value: formatMoney(invoice.totalCents, locale) },
    { key: 'amountPaid', label: t('finance.invoice.fields.amountPaid'), value: formatMoney(invoice.amountPaidCents, locale) },
    { key: 'balance', label: t('finance.invoice.fields.balance'), value: formatMoney(invoice.balanceCents, locale) },
    { key: 'issueDate', label: t('finance.invoice.fields.issueDate'), value: formatDate(invoice.issueDate, locale, timezone) },
    { key: 'dueDate', label: t('finance.invoice.fields.dueDate'), value: formatDate(invoice.dueDate, locale, timezone) },
    {
      key: 'paymentTerms',
      label: t('finance.invoice.fields.paymentTerms'),
      value: t('finance.invoice.fields.paymentTermsDays', { days: invoice.paymentTermsDays }),
    },
    ...(invoice.voidReason
      ? [{ key: 'voidReason', label: t('finance.invoice.fields.voidReason'), value: invoice.voidReason, fullWidth: true }]
      : []),
    ...(invoice.disputeReason
      ? [{ key: 'disputeReason', label: t('finance.invoice.fields.disputeReason'), value: invoice.disputeReason, fullWidth: true }]
      : []),
    ...(invoice.notes
      ? [{ key: 'notes', label: t('finance.invoice.fields.notes'), value: invoice.notes, fullWidth: true }]
      : []),
  ]

  const canVoid = invoice.status === 'draft' || invoice.status === 'sent' || invoice.status === 'due' || invoice.status === 'overdue' || invoice.status === 'disputed'
  const canMarkDue = invoice.status === 'sent'
  const canDispute = ['sent', 'due', 'overdue'].includes(invoice.status)
  const canMarkUncollectable = ['sent', 'due', 'overdue', 'disputed'].includes(invoice.status)
  const canMarkPaidManually = invoice.status === 'uncollectable'

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('finance.invoice.detail.title', { invoiceNumber: invoice.invoiceNumber })}
        status={<StatusBadge kind="invoice" value={invoice.status} />}
        secondaryActions={
          <div className="flex flex-wrap gap-2">
            {permissions.canSend && invoice.status === 'draft' ? <SendInvoiceButton invoiceId={invoice.id} /> : null}
            {permissions.canRecordPayment && invoice.balanceCents > 0 && invoice.status !== 'draft' ? (
              <RecordPaymentDialog invoiceId={invoice.id} balanceCents={invoice.balanceCents} />
            ) : null}
            {permissions.canStatusUpdate && canMarkDue ? (
              <StatusTransitionDialog
                invoiceId={invoice.id}
                toStatus="due"
                triggerLabel={t('finance.invoice.actions.markDue')}
                titleKey="finance.invoice.actions.markDueTitle"
                requireReason={false}
                successMessageKey="finance.invoice.actions.markDue"
              />
            ) : null}
            {permissions.canStatusUpdate && canDispute ? (
              <StatusTransitionDialog
                invoiceId={invoice.id}
                toStatus="disputed"
                triggerLabel={t('finance.invoice.actions.dispute')}
                titleKey="finance.invoice.actions.disputeTitle"
                reasonLabelKey="finance.invoice.actions.disputeReasonLabel"
                requireReason
                successMessageKey="finance.invoice.actions.disputedToast"
              />
            ) : null}
            {permissions.canStatusUpdate && canMarkUncollectable ? (
              <StatusTransitionDialog
                invoiceId={invoice.id}
                toStatus="uncollectable"
                triggerLabel={t('finance.invoice.actions.markUncollectable')}
                titleKey="finance.invoice.actions.uncollectableTitle"
                reasonLabelKey="finance.invoice.actions.uncollectableReasonLabel"
                requireReason={false}
                successMessageKey="finance.invoice.actions.uncollectableToast"
              />
            ) : null}
            {permissions.canStatusUpdate && canMarkPaidManually ? (
              <StatusTransitionDialog
                invoiceId={invoice.id}
                toStatus="paid"
                triggerLabel={t('finance.invoice.actions.recordPayment')}
                titleKey="finance.invoice.actions.markPaidTitle"
                requireReason={false}
                successMessageKey="finance.invoice.actions.recordPaymentSuccess"
              />
            ) : null}
            {permissions.canStatusUpdate && canVoid ? (
              <StatusTransitionDialog
                invoiceId={invoice.id}
                toStatus="voided"
                triggerLabel={t('finance.invoice.actions.void')}
                titleKey="finance.invoice.actions.voidTitle"
                reasonLabelKey="finance.invoice.actions.voidReasonLabel"
                requireReason
                successMessageKey="finance.invoice.actions.voidedToast"
                variant="destructive"
              />
            ) : null}
          </div>
        }
      />

      <Card>
        <CardContent className="pt-5">
          <DetailList items={items} />
        </CardContent>
      </Card>

      {permissions.canPay && invoice.balanceCents > 0 && invoice.status !== 'draft' && invoice.status !== 'voided' ? (
        <PayNowPanel invoiceId={invoice.id} balanceCents={invoice.balanceCents} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('finance.invoice.detail.lineItems')}</CardTitle>
        </CardHeader>
        <CardContent>
          {lineItems.length === 0 ? (
            <EmptyState icon={Receipt} title={t('common.states.empty')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('finance.invoice.detail.lineItems')}</TableHead>
                  <TableHead numeric>{t('finance.invoice.fields.total')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{locale === 'es' && item.descriptionEs ? item.descriptionEs : item.descriptionEn}</TableCell>
                    <TableCell numeric className="tabular">{formatMoney(item.amountCents, locale)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('finance.invoice.detail.paymentHistory')}</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <EmptyState icon={Receipt} title={t('common.states.empty')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('finance.invoice.payment.fields.method')}</TableHead>
                  <TableHead numeric>{t('finance.invoice.payment.fields.amount')}</TableHead>
                  <TableHead>{t('finance.invoice.fields.status')}</TableHead>
                  <TableHead>{t('finance.invoice.payment.fields.receivedAt')}</TableHead>
                  {permissions.canRefund ? <TableHead>{''}</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => {
                  const refundable = payment.amountCents - payment.refundedAmountCents
                  return (
                    <TableRow key={payment.id}>
                      <TableCell>{t(`finance.invoice.payment.method.${payment.method}`)}</TableCell>
                      <TableCell numeric className="tabular">{formatMoney(payment.amountCents, locale)}</TableCell>
                      <TableCell>
                        <Badge tone={PAYMENT_STATUS_TONE[payment.status]}>
                          {t(`finance.invoice.payment.status.${payment.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDateTime(payment.receivedAt ?? payment.createdAt, locale, timezone)}</TableCell>
                      {permissions.canRefund ? (
                        <TableCell>
                          {refundable > 0 && payment.status === 'succeeded' ? (
                            <RefundDialog paymentId={payment.id} refundableCents={refundable} />
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
