'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { PageHeader } from '@/components/shell/page-header'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate } from '@/i18n/translate'
import { endFactoringAssignmentAction } from '@/server/factoring/actions'
import type { Document, FactoringAssignment, FactoringCompany } from '@/db/schema'
import { ReceiptLink } from './receipt-link'
import { VerificationStatusForm } from './verification-status-form'
import { FactoringDocumentUploader } from './factoring-document-uploader'

const VERIFICATION_TONE = {
  not_started: 'neutral',
  pending: 'warning',
  verified: 'success',
  mismatch: 'danger',
  failed: 'danger',
  manually_overridden: 'warning',
  expired: 'danger',
} as const

export function AssignmentDetailView({
  assignment,
  company,
  carrierName,
  noticeOfAssignmentDocument,
  changeOfPayeeDocument,
  canManage,
}: {
  assignment: FactoringAssignment
  company: FactoringCompany | null
  carrierName: string
  noticeOfAssignmentDocument: Document | null
  changeOfPayeeDocument: Document | null
  canManage: boolean
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function endAssignment() {
    if (!window.confirm(t('finance.factoring.assignments.endAssignmentConfirm'))) return
    startTransition(async () => {
      const result = await endFactoringAssignmentAction({ assignmentId: assignment.id })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.factoring.assignments.endSuccess') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  const items: DetailItem[] = [
    { key: 'carrier', label: t('finance.factoring.assignments.fields.carrier'), value: carrierName },
    { key: 'company', label: t('finance.factoring.assignments.fields.factoringCompany'), value: company?.name ?? '—' },
    {
      key: 'effectiveFrom',
      label: t('finance.factoring.assignments.fields.effectiveFrom'),
      value: formatDate(assignment.effectiveFrom, locale, timezone),
    },
    {
      key: 'effectiveTo',
      label: t('finance.factoring.assignments.fields.effectiveTo'),
      value: formatDate(assignment.effectiveTo, locale, timezone),
    },
    {
      key: 'verifiedAt',
      label: t('finance.factoring.assignments.fields.verifiedAt'),
      value: formatDate(assignment.verifiedAt, locale, timezone),
    },
    ...(assignment.notes
      ? [{ key: 'notes', label: t('finance.factoring.assignments.fields.notes'), value: assignment.notes, fullWidth: true }]
      : []),
    {
      key: 'noa',
      label: t('finance.factoring.assignments.fields.noticeOfAssignment'),
      value: noticeOfAssignmentDocument ? (
        <ReceiptLink documentId={noticeOfAssignmentDocument.id} />
      ) : canManage ? (
        <FactoringDocumentUploader
          assignmentId={assignment.id}
          kind="notice_of_assignment"
          label={t('finance.factoring.assignments.uploadNoticeOfAssignment')}
        />
      ) : (
        '—'
      ),
    },
    {
      key: 'cop',
      label: t('finance.factoring.assignments.fields.changeOfPayee'),
      value: changeOfPayeeDocument ? (
        <ReceiptLink documentId={changeOfPayeeDocument.id} />
      ) : canManage ? (
        <FactoringDocumentUploader
          assignmentId={assignment.id}
          kind="change_of_payee"
          label={t('finance.factoring.assignments.uploadChangeOfPayee')}
        />
      ) : (
        '—'
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={carrierName}
        status={
          <Badge tone={VERIFICATION_TONE[assignment.verificationStatus]}>
            {t(`finance.factoring.assignments.verificationStatus.${assignment.verificationStatus}`)}
          </Badge>
        }
        secondaryActions={
          canManage && !assignment.effectiveTo ? (
            <Button type="button" variant="destructive" disabled={isPending} onClick={endAssignment}>
              {t('finance.factoring.assignments.endAssignment')}
            </Button>
          ) : undefined
        }
      />

      <Alert tone="warning">{t('finance.factoring.manualNoticeBanner')}</Alert>

      <Card>
        <CardContent className="pt-5">
          <DetailList items={items} />
        </CardContent>
      </Card>

      {canManage ? <VerificationStatusForm assignmentId={assignment.id} currentStatus={assignment.verificationStatus} /> : null}
    </div>
  )
}
