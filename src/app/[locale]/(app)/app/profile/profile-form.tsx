'use client'

import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField, SelectField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { updateProfileAction } from '@/server/auth/actions'

const COMMON_US_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
]

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'validation.required').max(100),
  lastName: z.string().trim().min(1, 'validation.required').max(100),
  phone: z.string().trim().max(32).optional(),
  locale: z.enum(['en', 'es']),
  timezone: z.string().min(1, 'validation.required'),
})

export function ProfileForm({
  defaultValues,
}: {
  defaultValues: { firstName: string; lastName: string; phone: string; locale: 'en' | 'es'; timezone: string }
}) {
  const t = useTranslate()

  const { form, onSubmit, isPending } = useActionForm({
    schema: profileSchema,
    defaultValues,
    action: updateProfileAction,
    successMessageKey: 'settings.profile.updated',
  })

  const timezoneOptions = COMMON_US_TIMEZONES.map((tz) => ({ value: tz, label: tz }))
  if (!COMMON_US_TIMEZONES.includes(defaultValues.timezone)) {
    timezoneOptions.unshift({ value: defaultValues.timezone, label: defaultValues.timezone })
  }

  return (
    <Card>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <FormErrorSummary title={t('errors.validationFailed')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="firstName" label={t('settings.profile.firstName')} autoComplete="given-name" required />
            <TextField name="lastName" label={t('settings.profile.lastName')} autoComplete="family-name" required />
          </div>
          <TextField name="phone" label={t('settings.profile.phone')} type="text" autoComplete="tel" />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="locale"
              label={t('settings.profile.locale')}
              options={[
                { value: 'en', label: 'English' },
                { value: 'es', label: 'Español' },
              ]}
            />
            <SelectField name="timezone" label={t('settings.profile.timezone')} options={timezoneOptions} />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
            {t('settings.profile.save')}
          </Button>
        </CardFooter>
      </Form>
    </Card>
  )
}
