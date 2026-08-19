'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { FileDrop, type FileDropItem } from '@/components/ui/file-drop'
import { Form, FormField } from '@/components/forms/form'
import { MoneyField, SelectField, TextareaField } from '@/components/forms/fields'
import { useActionForm } from '@/components/forms/use-action-form'
import { useTranslate } from '@/components/providers/i18n-provider'
import { submitExpenseAction } from '@/server/finance/actions'
import { searchLoadsForExpenseAction, searchCarriersForFinanceAction } from '@/server/finance/actions'
import { EntityCombobox } from './entity-combobox'
import type { ExpenseCategory } from '@/db/schema'

const formSchema = z.object({
  target: z.enum(['load', 'carrier']),
  loadId: z.string().uuid().nullable(),
  carrierId: z.string().uuid().nullable(),
  categoryId: z.string().uuid({ message: 'validation.required' }),
  amountCents: z
    .number({ message: 'validation.required' })
    .int()
    .positive({ message: 'validation.positive' }),
  description: z.string().max(2000).optional(),
  incurredOn: z.date().nullable().optional(),
})

type FormValues = z.infer<typeof formSchema>

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function ExpenseForm({
  locale,
  categories,
  defaultCarrierId,
  defaultCarrierLabel,
  showCarrierPicker,
}: {
  locale: string
  categories: ExpenseCategory[]
  defaultCarrierId?: string | null
  defaultCarrierLabel?: string | null
  showCarrierPicker: boolean
}) {
  const t = useTranslate()
  const router = useRouter()
  const [loadLabel, setLoadLabel] = React.useState<string | null>(null)
  const [carrierLabel, setCarrierLabel] = React.useState<string | null>(defaultCarrierLabel ?? null)
  const [file, setFile] = React.useState<File | null>(null)
  const [fileError, setFileError] = React.useState<string | null>(null)

  const { form, onSubmit, isPending } = useActionForm<FormValues, unknown>({
    schema: formSchema,
    defaultValues: {
      target: 'load',
      loadId: null,
      carrierId: defaultCarrierId ?? null,
      categoryId: '',
      amountCents: 0,
      description: '',
      incurredOn: null,
    },
    successMessageKey: 'finance.expense.submit.success',
    onSuccess: () => router.push(`/${locale}/app/expenses`),
    action: async (values) => {
      const category = categories.find((c) => c.id === values.categoryId)
      if (category?.requiresReceipt && !file) {
        setFileError(t('finance.validation.receiptRequired'))
        return { ok: false, error: { code: 'validation_failed', messageKey: 'finance.validation.receiptRequired' } }
      }
      setFileError(null)
      const receiptFileBase64 = file ? await fileToBase64(file) : undefined
      return submitExpenseAction({
        loadId: values.target === 'load' ? values.loadId ?? undefined : undefined,
        carrierId: values.target === 'carrier' ? values.carrierId ?? undefined : undefined,
        categoryId: values.categoryId,
        amountCents: values.amountCents,
        description: values.description || undefined,
        incurredOn: values.incurredOn ?? undefined,
        receiptFilename: file?.name,
        receiptFileBase64,
      })
    },
  })

  const target = form.watch('target')
  const categoryId = form.watch('categoryId')
  const selectedCategory = categories.find((c) => c.id === categoryId)

  const fileItems: FileDropItem[] = file
    ? [{ id: 'receipt', name: file.name, size: file.size, status: 'done' }]
    : []

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('finance.expense.submit.title')}</CardTitle>
        <CardDescription>{t('finance.expense.submit.description')}</CardDescription>
      </CardHeader>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="space-y-5">
          <div className="grid gap-1.5">
            <Label>{`${t('finance.expense.fields.load')} / ${t('finance.expense.fields.carrier')}`}</Label>
            <RadioGroup value={target} onValueChange={(v) => form.setValue('target', v as 'load' | 'carrier')}>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="target-load" value="load" />
                <Label htmlFor="target-load" className="font-normal">
                  {t('finance.expense.fields.load')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="target-carrier" value="carrier" />
                <Label htmlFor="target-carrier" className="font-normal">
                  {t('finance.expense.fields.carrier')}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {target === 'load' ? (
            <FormField<FormValues>
              name="loadId"
              label={t('finance.expense.fields.load')}
              required
              render={(bind) => (
                // Forward `bind.id` so `<Label htmlFor>` actually matches
                // the rendered control's id (see the identical fix on
                // `generate-settlement-form.tsx`).
                <EntityCombobox
                  id={bind.id}
                  invalid={bind.invalid}
                  aria-describedby={bind['aria-describedby']}
                  value={form.watch('loadId')}
                  selectedLabel={loadLabel}
                  onChange={(value, label) => {
                    form.setValue('loadId', value, { shouldValidate: true })
                    setLoadLabel(label)
                  }}
                  search={async (query) => {
                    const result = await searchLoadsForExpenseAction({ query })
                    return result.ok ? result.data : []
                  }}
                  placeholder={t('finance.expense.submit.searchLoadPlaceholder')}
                />
              )}
            />
          ) : showCarrierPicker ? (
            <FormField<FormValues>
              name="carrierId"
              label={t('finance.expense.fields.carrier')}
              required
              render={(bind) => (
                <EntityCombobox
                  id={bind.id}
                  invalid={bind.invalid}
                  aria-describedby={bind['aria-describedby']}
                  value={form.watch('carrierId')}
                  selectedLabel={carrierLabel}
                  onChange={(value, label) => {
                    form.setValue('carrierId', value, { shouldValidate: true })
                    setCarrierLabel(label)
                  }}
                  search={async (query) => {
                    const result = await searchCarriersForFinanceAction({ query })
                    return result.ok ? result.data : []
                  }}
                  placeholder={t('finance.expense.submit.searchCarrierPlaceholder')}
                />
              )}
            />
          ) : (
            <p className="text-sm text-steel-600">{carrierLabel}</p>
          )}

          <SelectField<FormValues>
            name="categoryId"
            label={t('finance.expense.fields.category')}
            required
            options={categories.map((c) => ({ value: c.id, label: locale === 'es' ? c.labelEs : c.labelEn }))}
          />

          <MoneyField<FormValues> name="amountCents" label={t('finance.expense.fields.amount')} required />

          <FormField<FormValues>
            name="incurredOn"
            label={t('finance.expense.fields.incurredOn')}
            render={(bind) => (
              <input
                {...bind}
                type="date"
                className="h-9 w-full rounded-md border border-steel-300 bg-white px-3 text-sm text-carbon focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                value={
                  form.watch('incurredOn') ? form.watch('incurredOn')!.toISOString().slice(0, 10) : ''
                }
                onChange={(event) =>
                  form.setValue('incurredOn', event.target.value ? new Date(event.target.value) : null)
                }
              />
            )}
          />

          <TextareaField<FormValues>
            name="description"
            label={t('finance.expense.fields.description')}
            rows={3}
          />

          <div className="grid gap-1.5">
            <Label>
              {t('finance.expense.fields.receipt')}
              {selectedCategory?.requiresReceipt ? <span className="ml-0.5 text-danger-700">*</span> : null}
            </Label>
            <FileDrop
              accept={['image/jpeg', 'image/png', 'application/pdf']}
              maxSizeBytes={10 * 1024 * 1024}
              files={fileItems}
              onFilesSelected={(files) => setFile(files[0] ?? null)}
              onRemove={() => setFile(null)}
              labels={{
                dropHint: t('finance.expense.submit.receiptDropHint'),
                browse: t('common.actions.upload'),
                acceptedTypes: t('finance.expense.submit.receiptAcceptedTypes'),
                maxSize: t('finance.expense.submit.receiptMaxSize'),
                remove: t('common.actions.remove'),
                retry: t('common.actions.retry'),
                uploading: t('common.states.loading'),
              }}
            />
            {fileError ? (
              <p role="alert" className="text-xs font-medium text-danger-700">
                {fileError}
              </p>
            ) : null}
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={isPending}>
            {t('finance.expense.submit.submitAction')}
          </Button>
        </CardFooter>
      </Form>
    </Card>
  )
}
