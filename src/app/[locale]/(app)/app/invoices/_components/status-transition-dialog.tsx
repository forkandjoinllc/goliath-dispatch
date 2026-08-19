'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { transitionInvoiceStatusAction } from '@/server/invoices/actions'
import type { InvoiceStatus } from '@/server/invoices/queries'

/** Void / dispute / mark-uncollectable / mark-due / mark-paid — every reason-driven invoice status change. */
export function StatusTransitionDialog({
  invoiceId,
  toStatus,
  triggerLabel,
  titleKey,
  reasonLabelKey,
  requireReason,
  successMessageKey,
  variant = 'secondary',
}: {
  invoiceId: string
  toStatus: InvoiceStatus
  triggerLabel: string
  titleKey: string
  reasonLabelKey?: string
  requireReason: boolean
  successMessageKey: string
  variant?: 'secondary' | 'destructive'
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [isPending, startTransition] = useTransition()

  function submit() {
    if (requireReason && reason.trim().length === 0) {
      toast({ tone: 'error', title: t('finance.validation.reasonRequired') })
      return
    }
    startTransition(async () => {
      const result = await transitionInvoiceStatusAction({ invoiceId, toStatus, reason: reason || undefined })
      if (result.ok) {
        toast({ tone: 'success', title: t(successMessageKey) })
        setOpen(false)
        setReason('')
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(titleKey)}</DialogTitle>
        </DialogHeader>
        {reasonLabelKey ? (
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={t(reasonLabelKey)}
          />
        ) : null}
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
