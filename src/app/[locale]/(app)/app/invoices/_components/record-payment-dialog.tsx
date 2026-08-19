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
import { MoneyField, SelectField, TextField, TextareaField } from '@/components/forms/fields'
import { useActionForm } from '@/components/forms/use-action-form'
import { useTranslate } from '@/components/providers/i18n-provider'
import { recordManualPaymentAction } from '@/server/invoices/actions'

const METHODS = ['card', 'ach', 'check', 'wire', 'cash', 'offset', 'other'] as const

const schema = z.object({
  amountCents: z.number().int().positive({ message: 'validation.positive' }),
  method: z.enum(METHODS),
  reference: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
})

export function RecordPaymentDialog({ invoiceId, balanceCents }: { invoiceId: string; balanceCents: number }) {
  const t = useTranslate()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  const { form, onSubmit, isPending } = useActionForm<z.infer<typeof schema>, unknown>({
    schema,
    defaultValues: { amountCents: balanceCents, method: 'check', reference: '', notes: '' },
    successMessageKey: 'finance.invoice.actions.recordPaymentSuccess',
    onSuccess: () => {
      setOpen(false)
      router.refresh()
    },
    action: (values) => recordManualPaymentAction({ invoiceId, ...values }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">{t('finance.invoice.actions.recordPayment')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('finance.invoice.actions.recordPaymentTitle')}</DialogTitle>
        </DialogHeader>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <MoneyField name="amountCents" label={t('finance.invoice.payment.fields.amount')} required />
          <SelectField
            name="method"
            label={t('finance.invoice.payment.fields.method')}
            required
            options={METHODS.map((value) => ({ value, label: t(`finance.invoice.payment.method.${value}`) }))}
          />
          <TextField name="reference" label={t('finance.invoice.payment.fields.reference')} />
          <TextareaField name="notes" label={t('finance.invoice.payment.fields.notes')} rows={2} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {t('common.actions.save')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
