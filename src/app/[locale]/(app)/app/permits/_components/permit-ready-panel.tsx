'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { useToast } from '@/components/ui/toast'
import { formatDateTime } from '@/i18n/translate'
import { approvePermitReadyAction } from '@/server/permits/actions'

export function PermitReadyPanel({
  loadId,
  approvedAt,
  approvedByLabel,
  canApprove,
}: {
  loadId: string
  approvedAt: Date | null
  approvedByLabel: string | null
  canApprove: boolean
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function approve() {
    startTransition(async () => {
      const result = await approvePermitReadyAction({ loadId })
      if (result.ok) {
        toast({ tone: 'success', title: t('oversize.readiness.success') })
        router.refresh()
      } else {
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          {t('oversize.readiness.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-steel-600">{t('oversize.readiness.description')}</p>
        {approvedAt ? (
          <Alert tone="info">
            {t('oversize.readiness.approved', { name: approvedByLabel ?? '—', date: formatDateTime(approvedAt, locale, timezone) })}
          </Alert>
        ) : (
          <p className="text-sm text-steel-600">{t('oversize.readiness.notApproved')}</p>
        )}
        {canApprove ? (
          <Button onClick={approve} loading={isPending}>
            {t('oversize.readiness.approveButton')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
