'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { setFactoringVerificationStatusAction } from '@/server/factoring/actions'
import type { FactoringVerificationStatus } from '@/server/factoring/service'

const STATUSES: FactoringVerificationStatus[] = [
  'not_started',
  'pending',
  'verified',
  'mismatch',
  'failed',
  'manually_overridden',
  'expired',
]

export function VerificationStatusForm({
  assignmentId,
  currentStatus,
}: {
  assignmentId: string
  currentStatus: FactoringVerificationStatus
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [status, setStatus] = React.useState<FactoringVerificationStatus>(currentStatus)
  const [reason, setReason] = React.useState('')
  const [isPending, startTransition] = useTransition()

  function submit() {
    startTransition(async () => {
      const result = await setFactoringVerificationStatusAction({
        assignmentId,
        status,
        reason: reason || undefined,
      })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.factoring.assignments.updateSuccess') })
        setReason('')
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('finance.factoring.assignments.setVerificationStatus')}</CardTitle>
        <CardDescription>{t('finance.factoring.manualNoticeShort')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={status} onValueChange={(v) => setStatus(v as FactoringVerificationStatus)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`finance.factoring.assignments.verificationStatus.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          placeholder={t('finance.factoring.assignments.setVerificationStatusReason')}
        />
        <Button type="button" disabled={isPending} onClick={submit}>
          {t('common.actions.save')}
        </Button>
      </CardContent>
    </Card>
  )
}
