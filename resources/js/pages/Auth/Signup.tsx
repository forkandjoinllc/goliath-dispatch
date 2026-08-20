import { Head, Link, useForm } from '@inertiajs/react'
import { AntiSpamFields } from '@/components/Form/AntiSpamFields'
import { CheckboxField, TextField } from '@/components/Form/Field'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import type { Locale } from '@/types'

interface Plan {
  code: string
  name: string
  description: string | null
  monthlyPriceCents: number
  trialDays: number
  features: string[]
  limits: { users: number | null; carriers: number | null; loadsPerMonth: number | null }
}

interface SignupData {
  company_name: string
  plan_code: string
  first_name: string
  last_name: string
  email: string
  password: string
  password_confirmation: string
  locale: string
  timezone: string
  privacy_consent: boolean
  terms_consent: boolean
  hp_field: string
  form_token: string
  [key: string]: string | boolean
}

export default function Signup({
  plans,
  formToken,
  legalLinks,
}: {
  plans: Plan[]
  formToken: string
  legalLinks: { privacy: string; terms: string }
}) {
  const { t, locale } = useI18n()

  const form = useForm<SignupData>({
    company_name: '',
    plan_code: plans[0]?.code ?? '',
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    password_confirmation: '',
    locale,
    // La zona horaria del navegador es una sugerencia razonable y el servidor la
    // valida. Es mejor que imponer America/New_York a una oficina en Laredo.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    privacy_consent: false,
    terms_consent: false,
    hp_field: '',
    form_token: formToken,
  })

  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement>) =>
    form.setData(key, event.target.value)

  return (
    <>
      <Head title={t('auth.signup.title')} />

      <div className="min-h-dvh bg-navy-50">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <Link href={`/${locale}`} className="inline-block">
            <img
              src="/brand/logo-primary.png"
              srcSet="/brand/logo-primary.png 1x, /brand/logo-primary@2x.png 2x"
              alt="Goliath Dispatch"
              width={168}
              height={40}
              className="h-9 w-auto"
            />
          </Link>

          <h1 className="mt-8 font-display text-3xl font-bold tracking-tight text-navy-700">
            {t('auth.signup.title')}
          </h1>
          <p className="mt-2 text-steel-700">{t('auth.signup.subtitle')}</p>

          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              form.post('/signup')
            }}
            className="relative mt-10 flex flex-col gap-10"
          >
            <AntiSpamFields token={formToken} />

            <section className="rounded border border-steel-200 bg-white p-6">
              <h2 className="font-display text-lg font-bold text-navy-700">
                {t('auth.signup.companyStep.title')}
              </h2>
              <p className="mt-1 text-sm text-steel-600">{t('auth.signup.companyStep.subtitle')}</p>
              <div className="mt-5">
                <TextField
                  label={t('auth.signup.companyName')}
                  required
                  autoComplete="organization"
                  value={form.data.company_name}
                  onChange={set('company_name')}
                  error={form.errors.company_name}
                />
              </div>
            </section>

            <section className="rounded border border-steel-200 bg-white p-6">
              <h2 className="font-display text-lg font-bold text-navy-700">
                {t('auth.signup.planStep.title')}
              </h2>
              <p className="mt-1 text-sm text-steel-600">{t('auth.signup.planStep.subtitle')}</p>

              <fieldset className="mt-5 grid gap-4 sm:grid-cols-3">
                <legend className="sr-only">{t('auth.signup.plan')}</legend>
                {plans.map((plan) => {
                  const selected = form.data.plan_code === plan.code
                  return (
                    <label
                      key={plan.code}
                      className={`flex cursor-pointer flex-col rounded border-2 p-4 transition ${
                        selected ? 'border-safety-600 bg-safety-50' : 'border-steel-200 hover:border-steel-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="plan_code"
                        value={plan.code}
                        checked={selected}
                        onChange={() => form.setData('plan_code', plan.code)}
                        className="sr-only"
                      />
                      <span className="uppercase-heading text-sm text-navy-700">{plan.name}</span>
                      <span className="mt-2 font-display text-2xl font-bold text-navy-700">
                        {t('auth.signup.planStep.perMonth', {
                          price: formatCents(plan.monthlyPriceCents, locale as Locale),
                        })}
                      </span>
                      {plan.description ? (
                        <span className="mt-2 text-xs text-steel-700">{plan.description}</span>
                      ) : null}
                      <span className="mt-3 text-xs font-medium text-safety-700">
                        {t('auth.signup.planStep.trialNotice', { days: plan.trialDays })}
                      </span>
                    </label>
                  )
                })}
              </fieldset>
              {form.errors.plan_code ? (
                <p role="alert" className="mt-3 text-xs font-medium text-safety-700">
                  {form.errors.plan_code}
                </p>
              ) : null}
            </section>

            <section className="rounded border border-steel-200 bg-white p-6">
              <h2 className="font-display text-lg font-bold text-navy-700">
                {t('auth.signup.admin.title')}
              </h2>
              <p className="mt-1 text-sm text-steel-600">{t('auth.signup.admin.subtitle')}</p>

              <div className="mt-5 flex flex-col gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField label={t('auth.signup.admin.firstName')} required autoComplete="given-name" value={form.data.first_name} onChange={set('first_name')} error={form.errors.first_name} />
                  <TextField label={t('auth.signup.admin.lastName')} required autoComplete="family-name" value={form.data.last_name} onChange={set('last_name')} error={form.errors.last_name} />
                </div>
                <TextField label={t('auth.signup.admin.email')} type="email" required autoComplete="email" value={form.data.email} onChange={set('email')} error={form.errors.email} />
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField label={t('auth.signup.admin.password')} type="password" required autoComplete="new-password" value={form.data.password} onChange={set('password')} error={form.errors.password} />
                  <TextField label={t('auth.signup.admin.confirmPassword')} type="password" required autoComplete="new-password" value={form.data.password_confirmation} onChange={set('password_confirmation')} error={form.errors.password_confirmation} />
                </div>
              </div>
            </section>

            <section className="rounded border border-steel-200 bg-white p-6">
              <h2 className="font-display text-lg font-bold text-navy-700">
                {t('auth.signup.consentsStep.title')}
              </h2>
              <p className="mt-1 text-sm text-steel-600">{t('auth.signup.consentsStep.subtitle')}</p>

              <div className="mt-5 flex flex-col gap-4">
                <CheckboxField
                  label={
                    <>
                      {t('marketing.forms.consent.privacyConsentPrefix')}{' '}
                      <a href={legalLinks.privacy} className="font-medium text-navy-700 underline">
                        {t('nav.public.privacy')}
                      </a>
                      .
                    </>
                  }
                  checked={form.data.privacy_consent}
                  onChange={(e) => form.setData('privacy_consent', e.target.checked)}
                  error={form.errors.privacy_consent}
                />
                <CheckboxField
                  label={
                    <>
                      {t('marketing.forms.consent.termsConsentPrefix')}{' '}
                      <a href={legalLinks.terms} className="font-medium text-navy-700 underline">
                        {t('nav.public.terms')}
                      </a>
                      .
                    </>
                  }
                  checked={form.data.terms_consent}
                  onChange={(e) => form.setData('terms_consent', e.target.checked)}
                  error={form.errors.terms_consent}
                />
              </div>
            </section>

            <button
              type="submit"
              disabled={form.processing}
              className="self-start rounded bg-safety-600 px-8 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {form.processing ? t('auth.signup.provisioning') : t('auth.signup.submit')}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
