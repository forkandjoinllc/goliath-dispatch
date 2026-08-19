'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/forms/form'
import { MoneyField, TextareaField } from '@/components/forms/fields'
import { useActionForm } from '@/components/forms/use-action-form'
import { useTranslate } from '@/components/providers/i18n-provider'
import { refundPaymentAction } from '@/server/invoices/actions'

const schema = z.object({
  amountCents: z.number().int().positive({ message: 'validation.positive' }).nullable(),
  reason: z.string().trim().min(1, { message: 'validation.required' }),
})

export function RefundDialog({ paymentId, refundableCents }: { paymentId: string; refundableCents: number }) {
  const t = useTranslate()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  const { form, onSubmit, isPending } = useActionForm<z.infer<typeof schema>, unknown>({
    schema,
    defaultValues: { amountCents: refundableCents, reason: '' },
    successMessageKey: 'finance.invoice.actions.refundSuccess',
    onSuccess: () => {
      setOpen(false)
      router.refresh()
    },
    action: (values) =>
      refundPaymentAction({ paymentId, amountCents: values.amountCents ?? undefined, reason: values.reason }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          {t('finance.invoice.actions.refund')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('finance.invoice.actions.refundTitle')}</DialogTitle>
        </DialogHeader>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <MoneyField name="amountCents" label={t('finance.invoice.actions.refundAmountLabel')} />
          <TextareaField name="reason" label={t('finance.invoice.actions.refundReasonLabel')} required rows={2} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {t('common.actions.confirm')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
