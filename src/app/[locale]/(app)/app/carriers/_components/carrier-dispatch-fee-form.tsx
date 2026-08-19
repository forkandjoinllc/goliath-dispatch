'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { setCarrierDispatchFeeAction } from '@/server/carriers/actions'
import type { Carrier } from '@/db/schema'

/** The one carrier field the server layer currently exposes an update path for — see the edit page's gap notice. */
export function CarrierDispatchFeeForm({ carrier, locale }: { carrier: Carrier; locale: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [feePercent, setFeePercent] = React.useState(String(carrier.dispatchFeeBps / 100))
  const [reason, setReason] = React.useState('')
  const [isPending, startTransition] = React.useTransition()

  function submit() {
    const bps = Math.round(Number(feePercent) * 100)
    if (!Number.isFinite(bps) || bps < 0 || bps > 10_000 || reason.trim().length === 0) return
    startTransition(async () => {
      const result = await setCarrierDispatchFeeAction({ carrierId: carrier.id, dispatchFeeBps: bps, reason })
      if (result.ok) {
        toast({ tone: 'success', title: t('common.actions.save') })
        router.push(`/${locale}/app/carriers/${carrier.id}`)
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('carrier.actions.setDispatchFee')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="carrier-edit-fee-percent">{t('carrier.fields.dispatchFeeBps')}</Label>
          <Input
            id="carrier-edit-fee-percent"
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={feePercent}
            onChange={(e) => setFeePercent(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="carrier-edit-fee-reason">{t('common.labels.reason')}</Label>
          <Input id="carrier-edit-fee-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push(`/${locale}/app/carriers/${carrier.id}`)}>
          {t('common.actions.cancel')}
        </Button>
        <Button type="button" disabled={isPending || reason.trim().length === 0} loading={isPending} onClick={submit}>
          {t('common.actions.save')}
        </Button>
      </CardFooter>
    </Card>
  )
}
