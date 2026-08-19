'use client'

import * as React from 'react'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { mfaChallengeAction } from '@/server/auth/actions'

const mfaChallengeSchema = z.object({
  code: z.string().trim().optional(),
  recoveryCode: z.string().trim().optional(),
})

export default function MfaChallengePage() {
  const t = useTranslate()
  const [useRecovery, setUseRecovery] = React.useState(false)

  const { form, onSubmit, isPending } = useActionForm({
    schema: mfaChallengeSchema,
    defaultValues: { code: '', recoveryCode: '' },
    action: mfaChallengeAction,
    // A hard navigation, not `router.push` — see the identical comment in
    // `(auth)/login/page.tsx`. A client-side push into `/app` here would hit
    // the same infinite-refetch loop the instant any layout under it needs
    // to redirect (e.g. a role change or tenant suspension since the
    // challenge was issued), and a full page load is no less correct for a
    // post-authentication redirect.
    onSuccess: (data) => window.location.assign(data.redirectTo),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('auth.mfa.title')}</CardTitle>
        <CardDescription>{useRecovery ? t('auth.mfa.recoveryCode') : t('auth.mfa.subtitle')}</CardDescription>
      </CardHeader>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <FormErrorSummary title={t('errors.validationFailed')} />
          {useRecovery ? (
            <TextField name="recoveryCode" label={t('auth.mfa.recoveryCode')} autoComplete="one-time-code" required />
          ) : (
            <TextField name="code" label={t('auth.mfa.code')} autoComplete="one-time-code" required />
          )}
          <button
            type="button"
            onClick={() => setUseRecovery((v) => !v)}
            className="text-sm font-medium text-navy-700 hover:underline"
          >
            {useRecovery ? t('auth.mfa.useCode') : t('auth.mfa.useRecovery')}
          </button>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-4">
          <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
            {t('auth.mfa.submit')}
          </Button>
        </CardFooter>
      </Form>
    </Card>
  )
}
