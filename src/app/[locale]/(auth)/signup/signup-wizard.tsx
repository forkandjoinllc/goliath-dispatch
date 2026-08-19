'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { useForm, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition } from 'react'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { CheckboxField, TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { formatMoney } from '@/i18n/translate'
import { signupAction } from '@/server/auth/actions'
import type { Locale } from '@/i18n/config'
import type { PlanSummary } from '@/server/tenants/queries'
import { PasswordStrengthMeter } from '../_components/password-strength'
import { cn } from '@/lib/utils'

const signupFormSchema = z
  .object({
    companyName: z.string().trim().min(2, 'validation.required'),
    admin: z.object({
      firstName: z.string().trim().min(1, 'validation.required'),
      lastName: z.string().trim().min(1, 'validation.required'),
      email: z.string().trim().min(1, 'validation.required'),
      password: z.string().min(1, 'validation.required'),
      confirmPassword: z.string().min(1, 'validation.required'),
    }),
    planCode: z.string().min(1, 'validation.required'),
    acceptPrivacy: z.boolean().refine((v) => v, { message: 'validation.consentRequired' }),
    acceptTerms: z.boolean().refine((v) => v, { message: 'validation.consentRequired' }),
  })
  .refine((v) => v.admin.password === v.admin.confirmPassword, {
    message: 'validation.confirmMismatch',
    path: ['admin', 'confirmPassword'],
  })

type SignupFormValues = z.infer<typeof signupFormSchema>

const STEP_KEYS = ['company', 'admin', 'plan', 'consents'] as const
type StepKey = (typeof STEP_KEYS)[number]

const STEP_FIELDS: Record<StepKey, FieldPath<SignupFormValues>[]> = {
  company: ['companyName'],
  admin: ['admin.firstName', 'admin.lastName', 'admin.email', 'admin.password', 'admin.confirmPassword'],
  plan: ['planCode'],
  consents: ['acceptPrivacy', 'acceptTerms'],
}

export function SignupWizard({ locale, plans }: { locale: Locale; plans: PlanSummary[] }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [stepIndex, setStepIndex] = React.useState(0)
  const [isPending, startTransition] = useTransition()

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: {
      companyName: '',
      admin: { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' },
      planCode: plans[0]?.code ?? '',
      acceptPrivacy: false,
      acceptTerms: false,
    },
  })

  const stepKey = STEP_KEYS[stepIndex]!
  const isLastStep = stepIndex === STEP_KEYS.length - 1
  const password = form.watch('admin.password')

  async function goNext() {
    const valid = await form.trigger(STEP_FIELDS[stepKey])
    if (!valid) return
    if (!isLastStep) {
      setStepIndex((i) => i + 1)
      return
    }

    const values = form.getValues()
    startTransition(async () => {
      const result = await signupAction({
        companyName: values.companyName,
        admin: {
          firstName: values.admin.firstName,
          lastName: values.admin.lastName,
          email: values.admin.email,
          password: values.admin.password,
        },
        planCode: values.planCode,
        locale,
        acceptPrivacy: values.acceptPrivacy,
        acceptTerms: values.acceptTerms,
      })

      if (result.ok) {
        router.push(result.data.redirectTo)
        return
      }
      if (result.fieldErrors) {
        for (const [path, messages] of Object.entries(result.fieldErrors)) {
          if (path === '_root' || !messages?.[0]) continue
          form.setError(path as FieldPath<SignupFormValues>, { type: 'server', message: messages[0] })
        }
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function goBack() {
    setStepIndex((i) => Math.max(0, i - 1))
  }

  if (isPending) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <Loader2 className="size-8 animate-spin text-navy-700" aria-hidden="true" />
          <div>
            <p className="text-base font-bold">{t('auth.signup.provisioningStep.title')}</p>
            <p className="mt-1 text-sm text-steel-600">{t('auth.signup.provisioningStep.subtitle')}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('auth.signup.title')}</CardTitle>
        <CardDescription>{t('auth.signup.subtitle')}</CardDescription>
        <ol className="mt-3 flex gap-2" aria-label={t('auth.signup.title')}>
          {STEP_KEYS.map((key, index) => (
            <li
              key={key}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                index <= stepIndex ? 'bg-navy-700' : 'bg-steel-200',
              )}
              aria-current={index === stepIndex ? 'step' : undefined}
            >
              <span className="sr-only">{t(`auth.signup.steps.${key}`)}</span>
            </li>
          ))}
        </ol>
      </CardHeader>
      <Form
        form={form}
        onSubmit={(event) => {
          event.preventDefault()
          void goNext()
        }}
      >
        <CardContent className="space-y-4">
          <FormErrorSummary title={t('errors.validationFailed')} />

          {stepKey === 'company' ? (
            <>
              <p className="text-sm font-semibold text-carbon">{t('auth.signup.companyStep.title')}</p>
              <p className="text-sm text-steel-600">{t('auth.signup.companyStep.subtitle')}</p>
              <TextField name="companyName" label={t('auth.signup.companyName')} required />
            </>
          ) : null}

          {stepKey === 'admin' ? (
            <>
              <p className="text-sm font-semibold text-carbon">{t('auth.signup.admin.title')}</p>
              <p className="text-sm text-steel-600">{t('auth.signup.admin.subtitle')}</p>
              <TextField name="admin.firstName" label={t('auth.signup.admin.firstName')} required />
              <TextField name="admin.lastName" label={t('auth.signup.admin.lastName')} required />
              <TextField name="admin.email" label={t('auth.signup.admin.email')} type="email" autoComplete="email" required />
              <TextField
                name="admin.password"
                label={t('auth.signup.admin.password')}
                type="password"
                autoComplete="new-password"
                required
              />
              <PasswordStrengthMeter password={password} />
              <TextField
                name="admin.confirmPassword"
                label={t('auth.signup.admin.confirmPassword')}
                type="password"
                autoComplete="new-password"
                required
              />
            </>
          ) : null}

          {stepKey === 'plan' ? (
            <>
              <p className="text-sm font-semibold text-carbon">{t('auth.signup.planStep.title')}</p>
              <p className="text-sm text-steel-600">{t('auth.signup.planStep.subtitle')}</p>
              <div className="grid gap-3">
                {plans.map((plan) => {
                  const selected = form.watch('planCode') === plan.code
                  const name = locale === 'es' ? plan.nameEs : plan.nameEn
                  const description = locale === 'es' ? plan.descriptionEs : plan.descriptionEn
                  return (
                    <button
                      type="button"
                      key={plan.code}
                      onClick={() => form.setValue('planCode', plan.code, { shouldValidate: true, shouldDirty: true })}
                      className={cn(
                        'rounded-lg border p-4 text-left transition-colors',
                        selected ? 'border-navy-700 bg-navy-50' : 'border-steel-200 hover:border-steel-300',
                      )}
                      aria-pressed={selected}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{name}</span>
                        <span className="text-sm font-semibold text-steel-700">
                          {t('auth.signup.planStep.perMonth', {
                            price: formatMoney(plan.monthlyPriceCents, locale, { showCents: false }),
                          })}
                        </span>
                      </div>
                      {description ? <p className="mt-1 text-sm text-steel-600">{description}</p> : null}
                      <p className="mt-2 text-xs text-steel-500">
                        {t('auth.signup.planStep.trialNotice', { days: plan.trialDays })}
                      </p>
                      {selected ? (
                        <p className="mt-2 text-xs font-semibold text-navy-700">{t('auth.signup.planStep.selected')}</p>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </>
          ) : null}

          {stepKey === 'consents' ? (
            <>
              <p className="text-sm font-semibold text-carbon">{t('auth.signup.consentsStep.title')}</p>
              <p className="text-sm text-steel-600">{t('auth.signup.consentsStep.subtitle')}</p>
              <CheckboxField
                name="acceptPrivacy"
                label={t('auth.consent.privacy', { link: t('auth.consent.privacyLink') })}
              />
              <CheckboxField name="acceptTerms" label={t('auth.consent.terms', { link: t('auth.consent.termsLink') })} />
            </>
          ) : null}
        </CardContent>

        <CardFooter className="justify-between">
          {stepIndex > 0 ? (
            <Button type="button" variant="secondary" onClick={goBack}>
              {t('common.actions.back')}
            </Button>
          ) : (
            <Link href={`/${locale}/login`} className="text-sm font-medium text-navy-700 hover:underline">
              {t('common.actions.back')}
            </Link>
          )}
          <Button type="submit">{isLastStep ? t('auth.signup.submit') : t('common.actions.next')}</Button>
        </CardFooter>
      </Form>
    </Card>
  )
}
