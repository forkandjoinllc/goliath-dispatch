'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/input'
import { useTranslate } from '@/components/providers/i18n-provider'

export interface DeclineDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string) => void | Promise<void>
  submitting: boolean
}

export function DeclineDialog({ open, onOpenChange, onConfirm, submitting }: DeclineDialogProps) {
  const t = useTranslate()
  const [reason, setReason] = React.useState('')
  const canSubmit = reason.trim().length >= 10 && !submitting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('signature.ceremony.declineDialogTitle')}</DialogTitle>
          <DialogDescription>{t('signature.ceremony.declineDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="decline-reason">{t('signature.ceremony.declineReasonLabel')}</Label>
          <Textarea
            id="decline-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!canSubmit}
            onClick={() => void onConfirm(reason.trim())}
          >
            {t('signature.ceremony.declineSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
