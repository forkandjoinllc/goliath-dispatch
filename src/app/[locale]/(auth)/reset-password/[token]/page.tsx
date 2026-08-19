'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { resetPasswordAction } from '@/server/auth/actions'
import { PasswordStrengthMeter } from '../../_components/password-strength'

const schema = z
  .object({
    password: z.string().min(1, 'validation.required'),
    confirmPassword: z.string().min(1, 'validation.required'),
  })
  .refine((v) => v.password === v.confirmPassword, { message: 'validation.confirmMismatch', path: ['confirmPassword'] })

export default function ResetPasswordPage() {
  const t = useTranslate()
  const router = useRouter()
  const { locale, token } = useParams<{ locale: string; token: string }>()

  const { form, onSubmit, isPending } = useActionForm({
    schema,
    defaultValues: { password: '', confirmPassword: '' },
    action: (values) => resetPasswordAction({ token, ...values }),
    onSuccess: () => router.push(`/${locale}/login`),
  })

  const password = form.watch('password')

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('auth.reset.title')}</CardTitle>
      </CardHeader>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <FormErrorSummary title={t('errors.validationFailed')} />
          <TextField
            name="password"
            label={t('auth.reset.password')}
            type="password"
            autoComplete="new-password"
            required
          />
          <PasswordStrengthMeter password={password} />
          <TextField
            name="confirmPassword"
            label={t('auth.reset.confirm')}
            type="password"
            autoComplete="new-password"
            required
          />
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-4">
          <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
            {t('auth.reset.submit')}
          </Button>
          <Link href={`/${locale}/login`} className="text-center text-sm font-medium text-navy-700 hover:underline">
            {t('common.actions.back')}
          </Link>
        </CardFooter>
      </Form>
    </Card>
  )
}
