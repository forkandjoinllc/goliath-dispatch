'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Alert } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { useI18n } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { reviewDriverLicenseAction } from '@/server/drivers/actions'
import type { Driver } from '@/db/schema'

export function DriverApprovalPanel({
  driver,
  reviewerName,
  canApprove,
}: {
  driver: Driver
  reviewerName: string | null
  canApprove: boolean
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [notes, setNotes] = React.useState('')

  function submit(status: 'verified' | 'failed') {
    if (status === 'failed' && notes.trim().length === 0) {
      toast({ tone: 'error', title: t('driver.approval.notesPlaceholder') })
      return
    }
    startTransition(async () => {
      const result = await reviewDriverLicenseAction({ driverId: driver.id, status, notes: notes || null })
      if (result.ok) {
        toast({ tone: 'success', title: t(status === 'verified' ? 'driver.approval.approve' : 'driver.approval.reject') })
        setNotes('')
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-carbon">{t('driver.approval.title')}</h3>
        <p className="text-sm text-steel-600">{t('driver.approval.description')}</p>
      </div>

      {driver.verifiedAt ? (
        <Alert tone="info">
          {t('driver.approval.reviewedBy', {
            reviewer: reviewerName ?? t('common.labels.none'),
            date: formatDateTime(driver.verifiedAt, locale, timezone),
          })}
          {driver.verificationNotes ? <p className="mt-1">{driver.verificationNotes}</p> : null}
        </Alert>
      ) : (
        <Alert tone="warning">{t('driver.approval.notReviewed')}</Alert>
      )}

      {canApprove ? (
        <div className="space-y-3 rounded-lg border border-steel-200 p-4">
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder={t('driver.approval.notesPlaceholder')}
          />
          <div className="flex gap-2">
            <Button type="button" disabled={isPending} onClick={() => submit('verified')}>
              {t('driver.approval.approve')}
            </Button>
            <Button type="button" variant="destructive" disabled={isPending} onClick={() => submit('failed')}>
              {t('driver.approval.reject')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
