'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import {
  issueSettlementAction,
  markSettlementPaidAction,
  recordFactoringSubmissionAction,
  voidSettlementAction,
} from '@/server/settlements/actions'

export function IssueSettlementButton({ settlementId }: { settlementId: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function issue() {
    if (!window.confirm(t('finance.settlement.actions.issueConfirm'))) return
    startTransition(async () => {
      const result = await issueSettlementAction({ settlementId })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.settlement.actions.issuedToast') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Button type="button" disabled={isPending} onClick={issue}>
      {t('finance.settlement.actions.issue')}
    </Button>
  )
}

export function MarkSettlementPaidButton({ settlementId }: { settlementId: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function markPaid() {
    startTransition(async () => {
      const result = await markSettlementPaidAction({ settlementId })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.settlement.actions.markPaidToast') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Button type="button" disabled={isPending} onClick={markPaid}>
      {t('finance.settlement.actions.markPaid')}
    </Button>
  )
}

export function VoidSettlementDialog({ settlementId }: { settlementId: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [isPending, startTransition] = useTransition()

  function submit() {
    if (reason.trim().length === 0) {
      toast({ tone: 'error', title: t('finance.validation.reasonRequired') })
      return
    }
    startTransition(async () => {
      const result = await voidSettlementAction({ settlementId, reason })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.settlement.actions.voidedToast') })
        setOpen(false)
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive">
          {t('finance.settlement.actions.void')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('finance.settlement.actions.void')}</DialogTitle>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          placeholder={t('finance.settlement.actions.voidReasonLabel')}
        />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="button" disabled={isPending} onClick={submit}>
            {t('common.actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RecordFactoringSubmissionButton({
  settlementId,
  factoringCompanyId,
  factoringCompanyName,
}: {
  settlementId: string
  factoringCompanyId: string
  factoringCompanyName: string
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function submit() {
    if (!window.confirm(t('finance.factoring.manualNoticeShort'))) return
    startTransition(async () => {
      const result = await recordFactoringSubmissionAction({ settlementId, factoringCompanyId })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.settlement.actions.submitToFactor') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Button type="button" variant="secondary" disabled={isPending} onClick={submit}>
      {t('finance.settlement.actions.submitToFactor')} ({factoringCompanyName})
    </Button>
  )
}
