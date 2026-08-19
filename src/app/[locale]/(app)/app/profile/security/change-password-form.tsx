'use client'

import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { changePasswordAction } from '@/server/auth/actions'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import { PasswordStrengthMeter } from '../../../_components/password-strength'

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'validation.required'),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH, 'validation.password.tooShort'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'validation.confirmMismatch',
    path: ['confirmPassword'],
  })

export function ChangePasswordForm() {
  const t = useTranslate()

  const { form, onSubmit, isPending } = useActionForm({
    schema: changePasswordSchema,
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    action: changePasswordAction,
    successMessageKey: 'settings.security.password.updated',
    onSuccess: () => form.reset({ currentPassword: '', newPassword: '', confirmPassword: '' }),
  })

  const newPassword = form.watch('newPassword')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.security.password.title')}</CardTitle>
      </CardHeader>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <FormErrorSummary title={t('errors.validationFailed')} />
          <TextField
            name="currentPassword"
            label={t('settings.security.password.current')}
            type="password"
            autoComplete="current-password"
            required
          />
          <TextField
            name="newPassword"
            label={t('settings.security.password.new')}
            type="password"
            autoComplete="new-password"
            required
          />
          <PasswordStrengthMeter password={newPassword ?? ''} />
          <TextField
            name="confirmPassword"
            label={t('settings.security.password.confirm')}
            type="password"
            autoComplete="new-password"
            required
          />
        </CardContent>
        <CardFooter>
          <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
            {t('settings.security.password.submit')}
          </Button>
        </CardFooter>
      </Form>
    </Card>
  )
}
