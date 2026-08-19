'use client'

import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form } from '@/components/forms/form'
import { TextField, SelectField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { updateCompanyIdentityAction } from '@/server/settings/actions'
import type { Locale } from '@/i18n/config'

const schema = z.object({
  legalName: z.string().trim().min(1, 'validation.required').max(200),
  displayName: z.string().trim().min(1, 'validation.required').max(200),
  defaultLocale: z.enum(['en', 'es']),
  defaultTimezone: z.string().trim().min(1, 'validation.required'),
  customDomain: z.string().trim().max(255),
})

type FormValues = z.infer<typeof schema>

export function CompanyForm({
  canUpdate,
  locales,
  defaultValues,
}: {
  canUpdate: boolean
  locales: readonly Locale[]
  defaultValues: FormValues
}) {
  const t = useTranslate()
  const { form, onSubmit, isPending } = useActionForm<FormValues, unknown>({
    schema,
    defaultValues,
    successMessageKey: 'settings.company.saved',
    action: (values) =>
      updateCompanyIdentityAction({
        ...values,
        customDomain: values.customDomain.trim() === '' ? null : values.customDomain.trim(),
      }),
  })

  return (
    <Card>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField<FormValues> name="legalName" label={t('settings.company.legalName')} required disabled={!canUpdate} />
          <TextField<FormValues> name="displayName" label={t('settings.company.displayName')} required disabled={!canUpdate} />
          <SelectField<FormValues>
            name="defaultLocale"
            label={t('settings.company.defaultLocale')}
            disabled={!canUpdate}
            options={locales.map((locale) => ({ value: locale, label: locale === 'en' ? 'English' : 'Español' }))}
          />
          <TextField<FormValues> name="defaultTimezone" label={t('settings.company.defaultTimezone')} disabled={!canUpdate} />
          <TextField<FormValues>
            name="customDomain"
            label={t('settings.company.customDomain')}
            description={t('settings.company.customDomainHint')}
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
