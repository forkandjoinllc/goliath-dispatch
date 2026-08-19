'use client'

import * as React from 'react'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form } from '@/components/forms/form'
import { TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { useTranslate } from '@/components/providers/i18n-provider'
import { resendVerificationEmailAction } from '@/server/auth/actions'

const schema = z.object({ email: z.string().trim().min(1, 'validation.required') })

export function ResendVerificationForm() {
  const t = useTranslate()
  const [sent, setSent] = React.useState(false)

  const { form, onSubmit, isPending } = useActionForm({
    schema,
    defaultValues: { email: '' },
    action: resendVerificationEmailAction,
    onSuccess: () => setSent(true),
  })

  if (sent) return <Alert tone="info">{t('auth.verify.sent', { email: '' })}</Alert>

  return (
    <Form form={form} onSubmit={onSubmit} className="space-y-3">
      <TextField name="email" label={t('auth.login.email')} type="email" autoComplete="email" required />
      <Button type="submit" variant="secondary" loading={isPending} loadingLabel={t('common.states.saving')}>
        {t('auth.verify.resend')}
      </Button>
    </Form>
  )
}
