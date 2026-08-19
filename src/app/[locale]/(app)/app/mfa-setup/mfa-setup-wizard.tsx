'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { beginMfaSetupAction, confirmMfaSetupAction } from '@/server/auth/actions'

const confirmSchema = z.object({ code: z.string().trim().min(1, 'validation.required') })

/** Pulls the `secret=` query param out of an `otpauth://` URI for the manual-entry fallback. */
function extractManualKey(otpauthUrl: string): string {
  try {
    const url = new URL(otpauthUrl)
    return url.searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
}

export function MfaSetupWizard({ locale }: { locale: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()

  const [step, setStep] = React.useState<'loading' | 'scan' | 'recovery' | 'error'>('loading')
  const [qrDataUrl, setQrDataUrl] = React.useState('')
  const [manualKey, setManualKey] = React.useState('')
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([])
  const [confirmed, setConfirmed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void beginMfaSetupAction().then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setStep('error')
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
        return
      }
      setQrDataUrl(result.data.qrDataUrl)
      setManualKey(extractManualKey(result.data.otpauthUrl))
      setRecoveryCodes(result.data.recoveryCodes)
      setStep('scan')
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { form, onSubmit, isPending } = useActionForm({
    schema: confirmSchema,
    defaultValues: { code: '' },
    action: confirmMfaSetupAction,
    onSuccess: () => setStep('recovery'),
  })

  if (step === 'loading') {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h1">{t('auth.mfa.setupTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="mx-auto size-48" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    )
  }

  if (step === 'error') {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h1">{t('errors.internal')}</CardTitle>
        </CardHeader>
      </Card>
    )
  }

  if (step === 'recovery') {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h1">{t('auth.mfa.recoveryTitle')}</CardTitle>
          <CardDescription>{t('auth.mfa.recoveryBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 gap-2 rounded-lg border border-steel-200 bg-steel-50 p-4 font-mono text-sm">
            {recoveryCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <label className="mt-4 flex items-start gap-2">
            <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
            <span className="text-sm text-steel-700">{t('auth.mfa.recoveryConfirm')}</span>
          </label>
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            disabled={!confirmed}
            onClick={() => {
              router.push(`/${locale}/app`)
              router.refresh()
            }}
          >
            {t('common.actions.continue')}
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('auth.mfa.setupTitle')}</CardTitle>
        <CardDescription>{t('auth.mfa.setupSubtitle')}</CardDescription>
      </CardHeader>
      <Form form={form} onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          {qrDataUrl ? (
            <Image
              src={qrDataUrl}
              alt={t('auth.mfa.setupTitle')}
              width={192}
              height={192}
              unoptimized
              className="mx-auto rounded-lg border border-steel-200 p-2"
            />
          ) : null}
          {manualKey ? (
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-steel-500">
                {t('auth.mfa.manualEntry')}
              </p>
              <Label className="sr-only" htmlFor="manual-key">
                {t('auth.mfa.manualEntry')}
              </Label>
              <code id="manual-key" className="mt-1 block break-all font-mono text-sm">
                {manualKey}
              </code>
            </div>
          ) : null}
          <FormErrorSummary title={t('errors.validationFailed')} />
          <TextField name="code" label={t('auth.mfa.confirmCode')} autoComplete="one-time-code" required />
        </CardContent>
        <CardFooter>
          <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
            {t('auth.mfa.submit')}
          </Button>
        </CardFooter>
      </Form>
    </Card>
  )
}
