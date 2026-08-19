'use client'

import * as React from 'react'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { CheckboxField, TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { CardContent, CardFooter } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { acceptInvitationAction } from '@/server/auth/actions'
import type { Locale } from '@/i18n/config'
import { PasswordStrengthMeter } from '../../_components/password-strength'

const schema = z
  .object({
    firstName: z.string().trim().min(1, 'validation.required'),
    lastName: z.string().trim().min(1, 'validation.required'),
    password: z.string().min(1, 'validation.required'),
    confirmPassword: z.string().min(1, 'validation.required'),
    acceptPrivacy: z.boolean().refine((v) => v, { message: 'validation.consentRequired' }),
    acceptTerms: z.boolean().refine((v) => v, { message: 'validation.consentRequired' }),
  })
  .refine((v) => v.password === v.confirmPassword, { message: 'validation.confirmMismatch', path: ['confirmPassword'] })

export function AcceptInvitationForm({ token, email, locale }: { token: string; email: string; locale: Locale }) {
  const t = useTranslate()

  const { form, onSubmit, isPending } = useActionForm({
    schema,
    defaultValues: {
      firstName: '',
      lastName: '',
      password: '',
      confirmPassword: '',
      acceptPrivacy: false,
      acceptTerms: false,
    },
    action: (values) =>
      acceptInvitationAction({
        token,
        ...values,
        locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    // A hard navigation, not `router.push` — see the identical comment in
    // `(auth)/login/page.tsx`. A brand-new Accounting/Admin invitee has
    // never enrolled in MFA yet, so `data.redirectTo` (`/app`) is exactly
    // the case whose layout redirects to `/app/mfa-setup`; pushing into it
    // client-side hits the infinite-refetch loop on the very first
    // invitation acceptance.
    onSuccess: (data) => window.location.assign(data.redirectTo),
  })

  const password = form.watch('password')

  return (
    <Form form={form} onSubmit={onSubmit}>
      <CardContent className="space-y-4">
        <FormErrorSummary title={t('errors.validationFailed')} />
        <TextField name="firstName" label={t('auth.invite.firstName')} required />
        <TextField name="lastName" label={t('auth.invite.lastName')} required />
        <p className="text-sm text-steel-600">{email}</p>
        <TextField name="password" label={t('auth.invite.password')} type="password" autoComplete="new-password" required />
        <PasswordStrengthMeter password={password} />
        <TextField
          name="confirmPassword"
          label={t('auth.invite.confirmPassword')}
          type="password"
          autoComplete="new-password"
          required
        />
        <CheckboxField
          name="acceptPrivacy"
          label={t('auth.consent.privacy', { link: t('auth.consent.privacyLink') })}
        />
        <CheckboxField name="acceptTerms" label={t('auth.consent.terms', { link: t('auth.consent.termsLink') })} />
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-4">
        <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
          {t('auth.invite.submit')}
        </Button>
      </CardFooter>
    </Form>
  )
}
