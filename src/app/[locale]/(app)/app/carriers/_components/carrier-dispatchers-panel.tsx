'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate } from '@/i18n/translate'
import {
  assignCarrierDispatcher,
  removeCarrierDispatcher,
  setPrimaryCarrierDispatcher,
} from '@/server/carriers/actions'
import type { CarrierDispatcherAssignment } from '@/db/schema'

export interface DispatcherOption {
  userId: string
  name: string
}

export interface CarrierDispatchersPanelProps {
  carrierId: string
  /** Active (not-yet-ended) assignments, current first. */
  active: CarrierDispatcherAssignment[]
  /** Ended assignments, for the history view. */
  history: CarrierDispatcherAssignment[]
  dispatcherNames: Record<string, string>
  availableDispatchers: DispatcherOption[]
  canManage: boolean
}

/** Assignment management: exactly one primary dispatcher, Admin-only assign/remove/promote. */
export function CarrierDispatchersPanel({
  carrierId,
  active,
  history,
  dispatcherNames,
  availableDispatchers,
  canManage,
}: CarrierDispatchersPanelProps) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = React.useTransition()
  const [selected, setSelected] = React.useState('')

  const assignedIds = new Set(active.map((a) => a.dispatcherUserId))
  const options = availableDispatchers.filter((d) => !assignedIds.has(d.userId))

  function handleAssign() {
    if (!selected) return
    startTransition(async () => {
      const result = await assignCarrierDispatcher({ carrierId, dispatcherUserId: selected })
      if (result.ok) {
        toast({ tone: 'success', title: t('carrier.actions.assignDispatcher') })
        setSelected('')
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function handleRemove(dispatcherUserId: string) {
    startTransition(async () => {
      const result = await removeCarrierDispatcher({ carrierId, dispatcherUserId })
      if (result.ok) {
        toast({ tone: 'success', title: t('carrier.actions.removeDispatcher') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function handleSetPrimary(dispatcherUserId: string) {
    startTransition(async () => {
      const result = await setPrimaryCarrierDispatcher({ carrierId, dispatcherUserId })
      if (result.ok) {
        toast({ tone: 'success', title: t('carrier.actions.setPrimaryDispatcher') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={t('carrier.actions.assignDispatcher')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.userId} value={option.userId}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" disabled={!selected || isPending} loading={isPending} onClick={handleAssign}>
            {t('carrier.actions.assignDispatcher')}
          </Button>
        </div>
      ) : null}

      {active.length === 0 ? (
        <EmptyState title={t('common.states.empty')} />
      ) : (
        <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
          {active.map((assignment) => (
            <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-2">
                {assignment.isPrimary ? <Star className="size-4 text-safety-500" aria-hidden="true" /> : null}
                <div>
                  <p className="font-semibold text-carbon">{dispatcherNames[assignment.dispatcherUserId] ?? assignment.dispatcherUserId}</p>
                  {assignment.isPrimary ? <p className="text-xs text-steel-600">{t('carrier.dispatchers.primaryLabel')}</p> : null}
                </div>
              </div>
              {canManage ? (
                <div className="flex items-center gap-2">
                  {!assignment.isPrimary ? (
                    <Button variant="secondary" size="sm" disabled={isPending} onClick={() => handleSetPrimary(assignment.dispatcherUserId)}>
                      {t('carrier.actions.setPrimaryDispatcher')}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={t('carrier.actions.removeDispatcher')}
                    disabled={isPending}
                    onClick={() => handleRemove(assignment.dispatcherUserId)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {history.length > 0 ? (
        <div>
          <h4 className="mb-2 text-sm font-bold text-carbon">{t('common.labels.details')}</h4>
          <ul className="space-y-1 text-sm text-steel-600">
            {history.map((assignment) => (
              <li key={assignment.id}>
                {dispatcherNames[assignment.dispatcherUserId] ?? assignment.dispatcherUserId} — {formatDate(assignment.startDate, locale, timezone)}
                {assignment.endDate ? ` – ${formatDate(assignment.endDate, locale, timezone)}` : ''}
                {assignment.reason ? ` (${assignment.reason})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
