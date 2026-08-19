'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { setDriverStatusAction } from '@/server/drivers/actions'
import type { Driver } from '@/db/schema'

const STATUSES: Driver['status'][] = ['available', 'on_load', 'off_duty', 'inactive']

export function DriverStatusActions({ driverId, status }: { driverId: string; status: Driver['status'] }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function submit(next: Driver['status']) {
    if (next === status) return
    startTransition(async () => {
      const result = await setDriverStatusAction({ driverId, status: next })
      if (result.ok) {
        toast({ tone: 'success', title: t(`driver.status.${next}`) })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    // See the identical fix/comment in `load-status-actions.tsx`: a
    // `role="combobox"` trigger with no `<Label>`/`aria-label` has no
    // accessible name at all (name-from-content doesn't apply to
    // `combobox`, unlike `button`), even though it visibly shows the
    // current status text.
    <Select value={status} onValueChange={(value) => submit(value as Driver['status'])} disabled={isPending}>
      <SelectTrigger className="w-40" aria-label={t('driver.fields.status')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((option) => (
          <SelectItem key={option} value={option}>
            {t(`driver.status.${option}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
