'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { transitionEquipmentStatusAction } from '@/server/equipment/actions'
import type { Truck } from '@/db/schema'

type EquipmentStatus = Truck['status']

/**
 * Mirrors `EQUIPMENT_TRANSITIONS` in `server/equipment/service.ts` for the
 * sole purpose of deciding which buttons to show — the server re-checks the
 * real rule (and the compliance gate for activation) on every submit, so a
 * stale client view can never produce an invalid transition, only an
 * inconvenient error toast.
 */
const NEXT_STATUSES: Record<EquipmentStatus, EquipmentStatus[]> = {
  pending_verification: ['active', 'archived'],
  active: ['out_of_service', 'archived'],
  out_of_service: ['active', 'archived'],
  archived: [],
}

export function EquipmentStatusActions({
  equipmentType,
  equipmentId,
  status,
}: {
  equipmentType: 'truck' | 'trailer'
  equipmentId: string
  status: EquipmentStatus
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [pendingTarget, setPendingTarget] = React.useState<EquipmentStatus | null>(null)
  const [reason, setReason] = React.useState('')

  function submit(toStatus: EquipmentStatus, reasonValue?: string) {
    startTransition(async () => {
      const result = await transitionEquipmentStatusAction({
        equipmentType,
        equipmentId,
        toStatus,
        reason: reasonValue ?? null,
      })
      if (result.ok) {
        toast({ tone: 'success', title: t('equipment.actions.' + actionKeyFor(toStatus)) })
        setPendingTarget(null)
        setReason('')
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  const next = NEXT_STATUSES[status] ?? []
  if (next.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {next.map((toStatus) => (
        <Button
          key={toStatus}
          type="button"
          variant={toStatus === 'archived' ? 'destructive' : 'secondary'}
          size="sm"
          disabled={isPending}
          onClick={() => {
            if (toStatus === 'out_of_service') {
              setPendingTarget(toStatus)
            } else {
              submit(toStatus)
            }
          }}
        >
          {t('equipment.actions.' + actionKeyFor(toStatus))}
        </Button>
      ))}

      <Dialog open={pendingTarget === 'out_of_service'} onOpenChange={(open) => !open && setPendingTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('equipment.actions.setOutOfService')}</DialogTitle>
            <DialogDescription>{t('equipment.fields.outOfServiceReason')}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={t('equipment.fields.outOfServiceReason')}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPendingTarget(null)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={reason.trim().length === 0 || isPending}
              onClick={() => submit('out_of_service', reason)}
            >
              {t('common.actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function actionKeyFor(status: EquipmentStatus): string {
  switch (status) {
    case 'active':
      return 'activate'
    case 'out_of_service':
      return 'setOutOfService'
    case 'archived':
      return 'archive'
    default:
      return 'activate'
  }
}

export type { EquipmentStatus }
