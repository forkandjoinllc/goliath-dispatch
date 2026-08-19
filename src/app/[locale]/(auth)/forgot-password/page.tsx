'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert } from '@/components/ui/feedback'
import { useTranslate } from '@/components/providers/i18n-provider'
import { forgotPasswordAction } from '@/server/auth/actions'

const schema = z.object({ email: z.string().trim().min(1, 'validation.required') })

export default function ForgotPasswordPage() {
  const t = useTranslate()
  const { locale } = useParams<{ locale: string }>()
  const [sent, setSent] = React.useState(false)

  const { form, onSubmit, isPending } = useActionForm({
    schema,
    defaultValues: { email: '' },
    action: forgotPasswordAction,
    onSuccess: () => setSent(true),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('auth.forgot.title')}</CardTitle>
        <CardDescription>{t('auth.forgot.subtitle')}</CardDescription>
      </CardHeader>
      {sent ? (
        <CardContent>
          <Alert tone="info">{t('auth.forgot.sent')}</Alert>
        </CardContent>
      ) : (
        <Form form={form} onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <FormErrorSummary title={t('errors.validationFailed')} />
            <TextField name="email" label={t('auth.login.email')} type="email" autoComplete="email" required />
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-4">
            <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
              {t('auth.forgot.submit')}
            </Button>
          </CardFooter>
        </Form>
      )}
      <CardFooter className="justify-center">
        <Link href={`/${locale}/login`} className="text-sm font-medium text-navy-700 hover:underline">
          {t('common.actions.back')}
        </Link>
      </CardFooter>
    </Card>
  )
}
