'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Form, FormField } from '@/components/forms/form'
import { SelectField, TextareaField } from '@/components/forms/fields'
import { useActionForm } from '@/components/forms/use-action-form'
import { useTranslate } from '@/components/providers/i18n-provider'
import { generateSettlementAction } from '@/server/settlements/actions'
import { searchCarriersForSettlementAction } from '@/server/finance/actions'
import { EntityCombobox } from './entity-combobox'
import type { FactoringCompany } from '@/db/schema'

const schema = z.object({
  carrierId: z.string().uuid({ message: 'validation.required' }),
  periodStart: z.string().min(1, { message: 'validation.required' }),
  periodEnd: z.string().min(1, { message: 'validation.required' }),
  factoringCompanyId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
})

export function GenerateSettlementForm({
  locale,
  factoringCompanies,
}: {
  locale: string
  factoringCompanies: FactoringCompany[]
}) {
  const t = useTranslate()
  const router = useRouter()
  const [carrierLabel, setCarrierLabel] = React.useState<string | null>(null)

  const { form, onSubmit, isPending } = useActionForm<z.infer<typeof schema>, { settlement: { id: string } }>({
    schema,
    defaultValues: { carrierId: '', periodStart: '', periodEnd: '', factoringCompanyId: undefined, notes: '' },
    successMessageKey: 'finance.settlement.generate.success',
    onSuccess: (data) => router.push(`/${locale}/app/settlements/${data.settlement.id}`),
    action: (values) =>
      generateSettlementAction({
        carrierId: values.carrierId,
        periodStart: new Date(values.periodStart),
        periodEnd: new Date(values.periodEnd),
        notes: values.notes || undefined,
        factoringCompanyId: values.factoringCompanyId,
      }),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('finance.settlement.generate.title')}</CardTitle>
        <CardDescription>{t('finance.settlement.generate.description')}</CardDescription>
      </CardHeader>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="space-y-5">
          <FormField<z.infer<typeof schema>>
            name="carrierId"
            label={t('finance.settlement.generate.carrier')}
            required
            render={(bind) => (
              // `id`/`aria-describedby`/`invalid` from `bind` must be
              // forwarded — without `id`, the `<Label htmlFor>` FormField
              // renders points at nothing (`Combobox` falls back to its own
              // internally generated id), leaving this control with no
              // accessible name at all.
              <EntityCombobox
                id={bind.id}
                invalid={bind.invalid}
                aria-describedby={bind['aria-describedby']}
                value={form.watch('carrierId') || null}
                selectedLabel={carrierLabel}
                onChange={(value, label) => {
                  form.setValue('carrierId', value ?? '', { shouldValidate: true })
                  setCarrierLabel(label)
                }}
                search={async (query) => {
                  const result = await searchCarriersForSettlementAction({ query })
                  return result.ok ? result.data : []
                }}
              />
            )}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField<z.infer<typeof schema>>
              name="periodStart"
              label={t('finance.settlement.generate.periodStart')}
              required
              render={(bind) => <input {...bind} type="date" className="h-9 w-full rounded-md border border-steel-300 bg-white px-3 text-sm" {...form.register('periodStart')} />}
            />
            <FormField<z.infer<typeof schema>>
              name="periodEnd"
              label={t('finance.settlement.generate.periodEnd')}
              required
              render={(bind) => <input {...bind} type="date" className="h-9 w-full rounded-md border border-steel-300 bg-white px-3 text-sm" {...form.register('periodEnd')} />}
            />
          </div>

          {factoringCompanies.length > 0 ? (
            <SelectField<z.infer<typeof schema>>
              name="factoringCompanyId"
              label={t('finance.settlement.fields.factoringCompany')}
              options={factoringCompanies.map((c) => ({ value: c.id, label: c.name }))}
            />
          ) : null}

          <TextareaField<z.infer<typeof schema>> name="notes" label={t('finance.settlement.fields.notes')} rows={3} />
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={isPending}>
            {t('finance.settlement.generate.submit')}
          </Button>
        </CardFooter>
      </Form>
    </Card>
  )
}
