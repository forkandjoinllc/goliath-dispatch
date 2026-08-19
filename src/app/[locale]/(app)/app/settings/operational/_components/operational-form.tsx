'use client'

import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form } from '@/components/forms/form'
import { TextField, SwitchField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { updateOperationalPolicyAction } from '@/server/settings/actions'
import { NumberField } from '../../_components/number-field'

const schema = z.object({
  documentExpirationWarningDays: z.number().int().min(1).max(365),
  fmcsaReverificationDays: z.number().int().min(1).max(365),
  allowDispatcherResourceAssignment: z.boolean(),
  requireOversizeAdminValidation: z.boolean(),
  loadNumberPrefix: z.string().trim().min(1).max(12),
  invoiceNumberPrefix: z.string().trim().min(1).max(12),
  defaultPaymentTermsDays: z.number().int().min(0).max(365),
  publicTrackingEnabled: z.boolean(),
  publicTrackingTokenTtlHours: z.number().int().min(1).max(24 * 30),
})

type FormValues = z.infer<typeof schema>

export function OperationalForm({ canUpdate, defaultValues }: { canUpdate: boolean; defaultValues: FormValues }) {
  const t = useTranslate()
  const { form, onSubmit, isPending } = useActionForm<FormValues, unknown>({
    schema,
    defaultValues,
    successMessageKey: 'settings.operational.saved',
    action: updateOperationalPolicyAction,
  })

  return (
    <Card>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <NumberField<FormValues>
            name="documentExpirationWarningDays"
            label={t('settings.operational.documentExpirationWarningDays')}
            description={t('settings.operational.documentExpirationWarningDaysHint')}
            disabled={!canUpdate}
            min={1}
          />
          <NumberField<FormValues>
            name="fmcsaReverificationDays"
            label={t('settings.operational.fmcsaReverificationDays')}
            disabled={!canUpdate}
            min={1}
          />
          <TextField<FormValues> name="loadNumberPrefix" label={t('settings.operational.loadNumberPrefix')} disabled={!canUpdate} />
          <TextField<FormValues> name="invoiceNumberPrefix" label={t('settings.operational.invoiceNumberPrefix')} disabled={!canUpdate} />
          <NumberField<FormValues>
            name="defaultPaymentTermsDays"
            label={t('settings.operational.defaultPaymentTermsDays')}
            disabled={!canUpdate}
            min={0}
          />
          <NumberField<FormValues>
            name="publicTrackingTokenTtlHours"
            label={t('settings.operational.publicTrackingTokenTtlHours')}
            disabled={!canUpdate}
            min={1}
          />
          <SwitchField<FormValues>
            name="allowDispatcherResourceAssignment"
            label={t('settings.operational.allowDispatcherResourceAssignment')}
            description={t('settings.operational.allowDispatcherResourceAssignmentHint')}
            disabled={!canUpdate}
            className="sm:col-span-2"
          />
          <SwitchField<FormValues>
            name="requireOversizeAdminValidation"
            label={t('settings.operational.requireOversizeAdminValidation')}
            description={t('settings.operational.requireOversizeAdminValidationHint')}
            disabled={!canUpdate}
            className="sm:col-span-2"
          />
          <SwitchField<FormValues>
            name="publicTrackingEnabled"
            label={t('settings.operational.publicTrackingEnabled')}
            disabled={!canUpdate}
            className="sm:col-span-2"
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
