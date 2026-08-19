'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { CheckboxField, TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { loginAction, type LoginActionOutput } from '@/server/auth/actions'

const loginSchema = z.object({
  email: z.string().trim().min(1, 'validation.required'),
  password: z.string().min(1, 'validation.required'),
  remember: z.boolean().optional(),
})

export default function LoginPage() {
  const t = useTranslate()
  const router = useRouter()
  const { locale } = useParams<{ locale: string }>()

  const { form, onSubmit, isPending } = useActionForm({
    schema: loginSchema,
    defaultValues: { email: '', password: '', remember: false },
    action: loginAction,
    onSuccess: (data: LoginActionOutput) => {
      if (data.status === 'mfa_required') {
        router.push(`/${locale}/login/mfa`)
      } else {
        // A hard navigation, not `router.push`: `data.redirectTo` is `/app`,
        // and the `(app)/app` layout itself issues a server-side `redirect()`
        // for any not-yet-MFA-enrolled Admin/Accounting user (straight to
        // `/app/mfa-setup`). A client-side push into a route whose *layout*
        // (rather than the page) redirects sends the router into an infinite
        // loop of identical RSC re-fetches instead of following the redirect
        // once — reproduced directly against this build. A full page load
        // re-requests the destination as a normal document navigation, which
        // resolves the same server redirect correctly on the very first try.
        window.location.assign(data.redirectTo)
      }
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('auth.login.title')}</CardTitle>
        <CardDescription>{t('auth.login.subtitle')}</CardDescription>
      </CardHeader>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <FormErrorSummary title={t('errors.validationFailed')} />
          <TextField name="email" label={t('auth.login.email')} type="email" autoComplete="email" required />
          <TextField
            name="password"
            label={t('auth.login.password')}
            type="password"
            autoComplete="current-password"
            required
          />
          <div className="flex items-center justify-between gap-4">
            <CheckboxField name="remember" label={t('auth.login.remember')} />
            <Link
              href={`/${locale}/forgot-password`}
              className="shrink-0 text-sm font-medium text-navy-700 hover:underline"
            >
              {t('auth.login.forgot')}
            </Link>
          </div>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-4">
          <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
            {t('auth.login.submit')}
          </Button>
          <p className="text-center text-sm text-steel-600">
            {t('auth.login.noAccount')}{' '}
            <Link href={`/${locale}/signup`} className="font-semibold text-navy-700 hover:underline">
              {t('auth.login.signupLink')}
            </Link>
          </p>
        </CardFooter>
      </Form>
    </Card>
  )
}
