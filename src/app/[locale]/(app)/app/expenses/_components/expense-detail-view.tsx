'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Alert } from '@/components/ui/feedback'
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { PageHeader } from '@/components/shell/page-header'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate, formatMoney } from '@/i18n/translate'
import { approveExpenseAction, rejectExpenseAction } from '@/server/finance/actions'
import { ReceiptLink } from './receipt-link'
import type { Expense } from '@/db/schema'

const STATUS_TONE = {
  submitted: 'info',
  approved: 'success',
  rejected: 'danger',
  reimbursed: 'navy',
} as const

export function ExpenseDetailView({
  expense,
  categoryLabel,
  treatment,
  loadNumber,
  carrierName,
  submitterName,
  reviewerName,
  canApprove,
}: {
  expense: Expense
  categoryLabel: string
  treatment: Expense['treatmentSnapshot']
  loadNumber: string | null
  carrierName: string | null
  submitterName: string
  reviewerName: string | null
  canApprove: boolean
}) {
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [reason, setReason] = React.useState('')

  function approve() {
    startTransition(async () => {
      const result = await approveExpenseAction({ expenseId: expense.id })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.expense.approvalQueue.approvedToast') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function reject() {
    if (reason.trim().length === 0) {
      toast({ tone: 'error', title: t('finance.validation.rejectionReasonRequired') })
      return
    }
    startTransition(async () => {
      const result = await rejectExpenseAction({ expenseId: expense.id, reason })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.expense.approvalQueue.rejectedToast') })
        setReason('')
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  const items: DetailItem[] = [
    { key: 'category', label: t('finance.expense.fields.category'), value: categoryLabel },
    {
      key: 'target',
      label: `${t('finance.expense.fields.load')} / ${t('finance.expense.fields.carrier')}`,
      value: loadNumber ?? carrierName ?? '—',
    },
    { key: 'amount', label: t('finance.expense.fields.amount'), value: formatMoney(expense.amountCents, i18nLocale) },
    { key: 'treatment', label: t('finance.expense.fields.treatmentSnapshot'), value: t(`finance.expenseTreatment.${treatment}`) },
    {
      key: 'incurredOn',
      label: t('finance.expense.fields.incurredOn'),
      value: formatDate(expense.incurredOn, i18nLocale, timezone),
    },
    { key: 'submittedBy', label: t('finance.expense.fields.submittedBy'), value: submitterName },
    {
      key: 'submittedAt',
      label: t('finance.expense.fields.submittedAt'),
      value: formatDate(expense.createdAt, i18nLocale, timezone),
    },
    ...(expense.description
      ? [{ key: 'description', label: t('finance.expense.fields.description'), value: expense.description, fullWidth: true }]
      : []),
    ...(expense.reviewedByUserId
      ? [
          { key: 'reviewedBy', label: t('finance.expense.fields.reviewedBy'), value: reviewerName ?? '—' },
          {
            key: 'reviewedAt',
            label: t('finance.expense.fields.reviewedAt'),
            value: formatDate(expense.reviewedAt, i18nLocale, timezone),
          },
        ]
      : []),
    ...(expense.rejectionReason
      ? [{ key: 'rejectionReason', label: t('finance.expense.fields.rejectionReason'), value: expense.rejectionReason, fullWidth: true }]
      : []),
    ...(expense.receiptDocumentId
      ? [{ key: 'receipt', label: t('finance.expense.fields.receipt'), value: <ReceiptLink documentId={expense.receiptDocumentId} /> }]
      : []),
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('finance.expense.title')}
        status={<Badge tone={STATUS_TONE[expense.status]}>{t(`finance.expense.status.${expense.status}`)}</Badge>}
      />
      <Card>
        <CardContent className="pt-5">
          <DetailList items={items} />
        </CardContent>
      </Card>

      {canApprove && expense.status === 'submitted' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('finance.expense.approvalQueue.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert tone="info">{t('finance.expense.approvalQueue.confirmApprove')}</Alert>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder={t('finance.expense.approvalQueue.rejectReasonLabel')}
            />
            <div className="flex gap-2">
              <Button type="button" disabled={isPending} onClick={approve}>
                {t('finance.expense.approvalQueue.approve')}
              </Button>
              <Button type="button" variant="destructive" disabled={isPending} onClick={reject}>
                {t('finance.expense.approvalQueue.reject')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
