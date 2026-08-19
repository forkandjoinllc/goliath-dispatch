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
import { CheckboxField, SelectField, SwitchField, TextField } from '@/components/forms/fields'
import { useActionForm } from '@/components/forms/use-action-form'
import { useTranslate } from '@/components/providers/i18n-provider'
import {
  createExpenseCategoryAction,
  updateExpenseCategoryAction,
} from '@/server/finance/actions'
import type { ExpenseCategory } from '@/db/schema'

const TREATMENTS = [
  'excluded_from_commission',
  'reimbursable_to_carrier',
  'tenant_absorbed',
  'carrier_deduction',
] as const

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { message: 'validation.required' })
    .regex(/^[a-z0-9_-]+$/, { message: 'validation.required' }),
  labelEn: z.string().trim().min(1, { message: 'validation.required' }),
  labelEs: z.string().trim().min(1, { message: 'validation.required' }),
  treatment: z.enum(TREATMENTS),
  requiresReceipt: z.boolean(),
})

const editSchema = z.object({
  labelEn: z.string().trim().min(1, { message: 'validation.required' }),
  labelEs: z.string().trim().min(1, { message: 'validation.required' }),
  treatment: z.enum(TREATMENTS),
  requiresReceipt: z.boolean(),
  active: z.boolean(),
})

export function CategoryFormDialog({
  category,
  trigger,
}: {
  category?: ExpenseCategory
  trigger: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  if (category) {
    return (
      <EditDialog
        category={category}
        trigger={trigger}
        open={open}
        setOpen={setOpen}
        onSuccess={() => {
          setOpen(false)
          router.refresh()
        }}
      />
    )
  }

  return (
    <CreateDialog
      trigger={trigger}
      open={open}
      setOpen={setOpen}
      onSuccess={() => {
        setOpen(false)
        router.refresh()
      }}
    />
  )
}

function CreateDialog({
  trigger,
  open,
  setOpen,
  onSuccess,
}: {
  trigger: React.ReactNode
  open: boolean
  setOpen: (open: boolean) => void
  onSuccess: () => void
}) {
  const t = useTranslate()
  const { form, onSubmit, isPending } = useActionForm<z.infer<typeof createSchema>, unknown>({
    schema: createSchema,
    defaultValues: { code: '', labelEn: '', labelEs: '', treatment: 'tenant_absorbed', requiresReceipt: true },
    successMessageKey: 'finance.expense.category.createSuccess',
    onSuccess,
    action: (values) => createExpenseCategoryAction(values),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('finance.expense.category.new')}</DialogTitle>
        </DialogHeader>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <TextField name="code" label={t('finance.expense.category.code')} required />
          <TextField name="labelEn" label={t('finance.expense.category.labelEn')} required />
          <TextField name="labelEs" label={t('finance.expense.category.labelEs')} required />
          <SelectField
            name="treatment"
            label={t('finance.expense.category.treatment')}
            required
            options={TREATMENTS.map((value) => ({ value, label: t(`finance.expenseTreatment.${value}`) }))}
          />
          <CheckboxField name="requiresReceipt" label={t('finance.expense.category.requiresReceipt')} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {t('common.actions.create')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({
  category,
  trigger,
  open,
  setOpen,
  onSuccess,
}: {
  category: ExpenseCategory
  trigger: React.ReactNode
  open: boolean
  setOpen: (open: boolean) => void
  onSuccess: () => void
}) {
  const t = useTranslate()
  const { form, onSubmit, isPending } = useActionForm<z.infer<typeof editSchema>, unknown>({
    schema: editSchema,
    defaultValues: {
      labelEn: category.labelEn,
      labelEs: category.labelEs,
      treatment: category.treatment,
      requiresReceipt: category.requiresReceipt,
      active: category.active,
    },
    successMessageKey: 'finance.expense.category.updateSuccess',
    onSuccess,
    action: (values) => updateExpenseCategoryAction({ categoryId: category.id, ...values }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('finance.expense.category.edit')}</DialogTitle>
        </DialogHeader>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <TextField name="labelEn" label={t('finance.expense.category.labelEn')} required />
          <TextField name="labelEs" label={t('finance.expense.category.labelEs')} required />
          <SelectField
            name="treatment"
            label={t('finance.expense.category.treatment')}
            required
            disabled={category.isSystem}
            options={TREATMENTS.map((value) => ({ value, label: t(`finance.expenseTreatment.${value}`) }))}
          />
          {category.isSystem ? <p className="text-xs text-steel-600">{t('finance.expense.category.systemLockedHint')}</p> : null}
          <CheckboxField name="requiresReceipt" label={t('finance.expense.category.requiresReceipt')} />
          <SwitchField name="active" label={t('finance.expense.category.active')} />
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
