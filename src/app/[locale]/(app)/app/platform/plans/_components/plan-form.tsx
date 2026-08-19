'use client'

import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form } from '@/components/forms/form'
import { TextField, TextareaField, CheckboxField, MoneyField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { CardContent, CardFooter } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { createPlanAction, updatePlanAction } from '@/server/platform/actions'
import { NumberField } from '../../../settings/_components/number-field'

const schema = z.object({
  code: z.string().trim().min(1, 'validation.required').max(40),
  nameEn: z.string().trim().min(1, 'validation.required').max(120),
  nameEs: z.string().trim().min(1, 'validation.required').max(120),
  descriptionEn: z.string().trim().max(2000),
  descriptionEs: z.string().trim().max(2000),
  monthlyPriceCents: z.number().int().min(0),
  trialDays: z.number().int().min(0).max(365),
  maxUsers: z.number().int().min(1).nullable(),
  maxCarriers: z.number().int().min(1).nullable(),
  maxLoadsPerMonth: z.number().int().min(1).nullable(),
  isPublic: z.boolean(),
  sortOrder: z.number().int(),
})

export type PlanFormValues = z.infer<typeof schema>

export function PlanForm({
  planId,
  defaultValues,
  onSaved,
}: {
  planId?: string
  defaultValues: PlanFormValues
  onSaved: () => void
}) {
  const t = useTranslate()
  const { form, onSubmit, isPending } = useActionForm<PlanFormValues, unknown>({
    schema,
    defaultValues,
    successMessageKey: planId ? 'platform.plans.updated' : 'platform.plans.created',
    action: (values) =>
      planId
        ? updatePlanAction({ planId, patch: values })
        : createPlanAction({ ...values, features: [] }),
    onSuccess: onSaved,
  })

  return (
    <Form form={form} onSubmit={onSubmit}>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <TextField<PlanFormValues> name="code" label={t('platform.plans.code')} required disabled={Boolean(planId)} />
        <NumberField<PlanFormValues> name="sortOrder" label={t('platform.plans.sortOrder')} />
        <TextField<PlanFormValues> name="nameEn" label={t('platform.plans.nameEn')} required />
        <TextField<PlanFormValues> name="nameEs" label={t('platform.plans.nameEs')} required />
        <TextareaField<PlanFormValues> name="descriptionEn" label={t('platform.plans.descriptionEn')} />
        <TextareaField<PlanFormValues> name="descriptionEs" label={t('platform.plans.descriptionEs')} />
        <MoneyField<PlanFormValues> name="monthlyPriceCents" label={t('platform.plans.monthlyPrice')} required />
        <NumberField<PlanFormValues> name="trialDays" label={t('platform.plans.trialDays')} min={0} />
        <NumberField<PlanFormValues> name="maxUsers" label={t('platform.plans.maxUsers')} min={1} />
        <NumberField<PlanFormValues> name="maxCarriers" label={t('platform.plans.maxCarriers')} min={1} />
        <NumberField<PlanFormValues> name="maxLoadsPerMonth" label={t('platform.plans.maxLoadsPerMonth')} min={1} />
        <CheckboxField<PlanFormValues> name="isPublic" label={t('platform.plans.isPublic')} />
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button type="submit" loading={isPending}>
          {planId ? t('platform.plans.save') : t('platform.plans.create')}
        </Button>
      </CardFooter>
    </Form>
  )
}
