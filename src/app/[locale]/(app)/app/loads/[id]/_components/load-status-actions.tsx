'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { transitionLoadStatusAction } from '@/server/loads/actions'
import { legalDestinationsFrom, type LoadStatus } from '@/server/loads/status-machine'

function statusI18nKey(status: LoadStatus): string {
  return status.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * Offers every status the table legally allows from the current one — the
 * readiness gates (carrier present, compliance clear, POD on file, invoice
 * exists) are enforced server-side by `transitionStatus`, so an attempt that
 * isn't actually ready yet surfaces its specific `load.errors.*` message via
 * toast rather than being silently hidden from the menu.
 */
export function LoadStatusActions({ loadId, status }: { loadId: string; status: LoadStatus }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const destinations = legalDestinationsFrom(status)
  if (destinations.length === 0) return null

  function submit(to: LoadStatus) {
    startTransition(async () => {
      const result = await transitionLoadStatusAction({ loadId, to })
      if (result.ok) {
        toast({ tone: 'success', title: t(`nav.status.load.${statusI18nKey(to)}`) })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    // `aria-label` is required here: this trigger has no associated
    // `<Label>` and, unlike `role="button"`, `role="combobox"` does not
    // compute its accessible name from its visible text content (the
    // `SelectValue` placeholder span) — without an explicit label this
    // control has NO accessible name at all, a real WCAG 4.1.2 violation
    // that also made it unreachable by any name-based query/assistive tech.
    <Select value="" onValueChange={(value) => submit(value as LoadStatus)} disabled={isPending}>
      <SelectTrigger className="w-48" aria-label={t('load.actions.changeStatus')}>
        <SelectValue placeholder={t('load.actions.changeStatus')} />
      </SelectTrigger>
      <SelectContent>
        {destinations.map((option) => (
          <SelectItem key={option} value={option}>
            {t(`nav.status.load.${statusI18nKey(option)}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
