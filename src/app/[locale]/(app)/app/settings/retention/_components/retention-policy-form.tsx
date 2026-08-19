'use client'

import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form } from '@/components/forms/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { updateRetentionPolicyAction } from '@/server/settings/actions'
import { NumberField } from '../../_components/number-field'

const schema = z.object({
  operationalActiveMonths: z.number().int().min(1).max(600),
  operationalPurgeYearsAfterArchive: z.number().int().min(0).max(100),
  financialRetentionYears: z.number().int().min(7).max(100),
})

type FormValues = z.infer<typeof schema>

export function RetentionPolicyForm({ canUpdate, defaultValues }: { canUpdate: boolean; defaultValues: FormValues }) {
  const t = useTranslate()
  const { form, onSubmit, isPending } = useActionForm<FormValues, unknown>({
    schema,
    defaultValues,
    successMessageKey: 'settings.retention.saved',
    action: updateRetentionPolicyAction,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.retention.policyTitle')}</CardTitle>
      </CardHeader>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          <NumberField<FormValues>
            name="operationalActiveMonths"
            label={t('settings.retention.operationalActiveMonths')}
            description={t('settings.retention.operationalActiveMonthsHint')}
            disabled={!canUpdate}
            min={1}
          />
          <NumberField<FormValues>
            name="operationalPurgeYearsAfterArchive"
            label={t('settings.retention.operationalPurgeYearsAfterArchive')}
            description={t('settings.retention.operationalPurgeYearsAfterArchiveHint')}
            disabled={!canUpdate}
            min={0}
          />
          <NumberField<FormValues>
            name="financialRetentionYears"
            label={t('settings.retention.financialRetentionYears')}
            description={t('settings.retention.financialRetentionYearsHint')}
            disabled={!canUpdate}
            min={7}
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
