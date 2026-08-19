'use client'

import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form } from '@/components/forms/form'
import { PercentField, SelectField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { updateFinancialPolicyAction } from '@/server/settings/actions'

const schema = z.object({
  defaultCarrierDispatchFeeBps: z.number().int().min(0).max(10_000),
  defaultDispatcherCommissionBps: z.number().int().min(0).max(10_000),
  dispatcherCommissionBasis: z.enum(['dispatch_fee_amount', 'carrier_gross_rate', 'commissionable_base']),
})

type FormValues = z.infer<typeof schema>

export function FinancialForm({ canUpdate, defaultValues }: { canUpdate: boolean; defaultValues: FormValues }) {
  const t = useTranslate()
  const { form, onSubmit, isPending } = useActionForm<FormValues, unknown>({
    schema,
    defaultValues,
    successMessageKey: 'settings.financial.saved',
    action: updateFinancialPolicyAction,
  })

  return (
    <Card>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <PercentField<FormValues>
            name="defaultCarrierDispatchFeeBps"
            label={t('settings.financial.defaultCarrierDispatchFeeBps')}
            description={t('settings.financial.defaultCarrierDispatchFeeBpsHint')}
            disabled={!canUpdate}
          />
          <PercentField<FormValues>
            name="defaultDispatcherCommissionBps"
            label={t('settings.financial.defaultDispatcherCommissionBps')}
            description={t('settings.financial.defaultDispatcherCommissionBpsHint')}
            disabled={!canUpdate}
          />
          <SelectField<FormValues>
            name="dispatcherCommissionBasis"
            label={t('settings.financial.dispatcherCommissionBasis')}
            disabled={!canUpdate}
            className="sm:col-span-2"
            options={[
              { value: 'dispatch_fee_amount', label: t('settings.financial.basis.dispatchFeeAmount') },
              { value: 'carrier_gross_rate', label: t('settings.financial.basis.carrierGrossRate') },
              { value: 'commissionable_base', label: t('settings.financial.basis.commissionableBase') },
            ]}
          />
        </CardContent>
        {canUpdate ? (
          <CardFooter className="justify-end">
            <Button type="submit" loading={isPending}>
              {t('settings.actions.save')}
            </Button>
          </CardFooter>
        ) : null}
      </Form>
    </Card>
  )
}
