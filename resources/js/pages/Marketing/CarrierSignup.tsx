import { useForm } from '@inertiajs/react'
import { MarketingLayout } from '@/layouts/MarketingLayout'
import { AntiSpamFields } from '@/components/Form/AntiSpamFields'
import { CheckboxField, TextField } from '@/components/Form/Field'
import { PageHero } from '@/components/Marketing/PageHero'
import { Section } from '@/components/Marketing/Section'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

const NEXT_STEPS = ['coi', 'authority', 'w9', 'noa', 'equipmentPhotos'] as const

interface SignupData {
  legal_name: string
  dba: string
  dot_number: string
  mc_number: string
  website: string
  contact_first_name: string
  contact_last_name: string
  email: string
  phone: string
  physical_line1: string
  physical_line2: string
  physical_city: string
  physical_state: string
  physical_postal_code: string
  mailing_same_as_physical: boolean
  mailing_line1: string
  mailing_line2: string
  mailing_city: string
  mailing_state: string
  mailing_postal_code: string
  preferred_locale: string
  uses_factoring: boolean
  lead_consent: boolean
  privacy_consent: boolean
  terms_consent: boolean
  hp_field: string
  form_token: string
  [key: string]: string | boolean
}

export default function CarrierSignup({
  formToken,
  ...props
}: MarketingPageProps & { formToken: string }) {
  const { t, locale } = useI18n()

  const form = useForm<SignupData>({
    legal_name: '', dba: '', dot_number: '', mc_number: '', website: '',
    contact_first_name: '', contact_last_name: '', email: '', phone: '',
    physical_line1: '', physical_line2: '', physical_city: '', physical_state: '', physical_postal_code: '',
    mailing_same_as_physical: true,
    mailing_line1: '', mailing_line2: '', mailing_city: '', mailing_state: '', mailing_postal_code: '',
    preferred_locale: locale,
    uses_factoring: false,
    lead_consent: false, privacy_consent: false, terms_consent: false,
    hp_field: '', form_token: formToken,
  })

  const label = (key: string) => t(`marketing.forms.labels.${key}`)
  const section = (key: string) => t(`marketing.carrierSignup.sections.${key}`)

  if (form.wasSuccessful) {
    return (
      <MarketingLayout {...props}>
        <PageHero title={t('marketing.carrierSignup.hero.title')} />
        <Section>
          <div role="status" className="mx-auto max-w-2xl rounded border-l-4 border-safety-500 bg-navy-50 p-8">
            <h2 className="font-display text-2xl font-bold text-navy-700">
              {t('marketing.carrierSignup.success.title')}
            </h2>
            <p className="mt-3 text-steel-700">{t('marketing.carrierSignup.success.body')}</p>
          </div>
        </Section>
      </MarketingLayout>
    )
  }

  const set = <K extends keyof SignupData>(key: K) => (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => form.setData(key as string, event.target.value as SignupData[K])

  return (
    <MarketingLayout {...props}>
      <PageHero
        title={t('marketing.carrierSignup.hero.title')}
        subtitle={t('marketing.carrierSignup.hero.subtitle')}
      />

      <Section>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              form.post('/carrier-signup', { preserveScroll: true })
            }}
            className="relative flex flex-col gap-10"
          >
            <AntiSpamFields token={formToken} />

            <fieldset className="flex flex-col gap-5">
              <legend className="uppercase-heading mb-4 text-sm text-navy-700">{section('companyInfo')}</legend>
              <TextField label={label('legalName')} required value={form.data.legal_name} onChange={set('legal_name')} error={form.errors.legal_name} />
              <TextField label={label('dba')} value={form.data.dba} onChange={set('dba')} error={form.errors.dba} />
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField label={label('dotNumber')} required inputMode="numeric" value={form.data.dot_number} onChange={set('dot_number')} error={form.errors.dot_number} />
                <TextField label={label('mcNumber')} value={form.data.mc_number} onChange={set('mc_number')} error={form.errors.mc_number} />
              </div>
              <TextField label={label('website')} type="url" value={form.data.website} onChange={set('website')} error={form.errors.website} />
            </fieldset>

            <fieldset className="flex flex-col gap-5">
              <legend className="uppercase-heading mb-4 text-sm text-navy-700">{section('contactInfo')}</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField label={label('contactFirstName')} required autoComplete="given-name" value={form.data.contact_first_name} onChange={set('contact_first_name')} error={form.errors.contact_first_name} />
                <TextField label={label('contactLastName')} required autoComplete="family-name" value={form.data.contact_last_name} onChange={set('contact_last_name')} error={form.errors.contact_last_name} />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField label={label('email')} type="email" required autoComplete="email" value={form.data.email} onChange={set('email')} error={form.errors.email} />
                <TextField label={label('phone')} type="tel" required autoComplete="tel" value={form.data.phone} onChange={set('phone')} error={form.errors.phone} />
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-5">
              <legend className="uppercase-heading mb-4 text-sm text-navy-700">{section('addresses')}</legend>
              <p className="text-sm font-medium text-steel-700">{label('physicalAddress')}</p>
              <TextField label={label('addressLine1')} required value={form.data.physical_line1} onChange={set('physical_line1')} error={form.errors.physical_line1} />
              <TextField label={label('addressLine2')} value={form.data.physical_line2} onChange={set('physical_line2')} error={form.errors.physical_line2} />
              <div className="grid gap-5 sm:grid-cols-3">
                <TextField label={label('city')} required value={form.data.physical_city} onChange={set('physical_city')} error={form.errors.physical_city} />
                <TextField label={label('state')} required maxLength={2} value={form.data.physical_state} onChange={set('physical_state')} error={form.errors.physical_state} />
                <TextField label={label('postalCode')} required value={form.data.physical_postal_code} onChange={set('physical_postal_code')} error={form.errors.physical_postal_code} />
              </div>

              <CheckboxField
                label={label('mailingSameAsPhysical')}
                checked={form.data.mailing_same_as_physical}
                onChange={(e) => form.setData('mailing_same_as_physical', e.target.checked)}
              />

              {!form.data.mailing_same_as_physical ? (
                <div className="flex flex-col gap-5 border-l-2 border-steel-200 pl-5">
                  <p className="text-sm font-medium text-steel-700">{label('mailingAddress')}</p>
                  <TextField label={label('addressLine1')} required value={form.data.mailing_line1} onChange={set('mailing_line1')} error={form.errors.mailing_line1} />
                  <TextField label={label('addressLine2')} value={form.data.mailing_line2} onChange={set('mailing_line2')} error={form.errors.mailing_line2} />
                  <div className="grid gap-5 sm:grid-cols-3">
                    <TextField label={label('city')} required value={form.data.mailing_city} onChange={set('mailing_city')} error={form.errors.mailing_city} />
                    <TextField label={label('state')} required maxLength={2} value={form.data.mailing_state} onChange={set('mailing_state')} error={form.errors.mailing_state} />
                    <TextField label={label('postalCode')} required value={form.data.mailing_postal_code} onChange={set('mailing_postal_code')} error={form.errors.mailing_postal_code} />
                  </div>
                </div>
              ) : null}
            </fieldset>

            <fieldset className="flex flex-col gap-5">
              <legend className="uppercase-heading mb-4 text-sm text-navy-700">{section('preferences')}</legend>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="preferred-locale" className="text-sm font-medium text-carbon">
                  {label('preferredLanguage')}
                </label>
                <select
                  id="preferred-locale"
                  value={form.data.preferred_locale}
                  onChange={(e) => form.setData('preferred_locale', e.target.value)}
                  className="rounded border border-steel-300 bg-white px-3 py-2 text-sm text-carbon focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-200"
                >
                  <option value="en">English</option>
                  <option value="es">Español</option>
                </select>
              </div>
              <CheckboxField
                label={label('factoringApplies')}
                checked={form.data.uses_factoring}
                onChange={(e) => form.setData('uses_factoring', e.target.checked)}
              />
            </fieldset>

            <fieldset className="flex flex-col gap-4">
              <legend className="uppercase-heading mb-4 text-sm text-navy-700">{section('consent')}</legend>
              <CheckboxField
                label={t('marketing.forms.consent.leadConsent')}
                checked={form.data.lead_consent}
                onChange={(e) => form.setData('lead_consent', e.target.checked)}
                error={form.errors.lead_consent}
              />
              <CheckboxField
                label={
                  <>
                    {t('marketing.forms.consent.privacyConsentPrefix')}{' '}
                    <a href={`/${locale}/privacy`} className="font-medium text-navy-700 underline">
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
                    <a href={`/${locale}/terms`} className="font-medium text-navy-700 underline">
                      {t('nav.public.terms')}
                    </a>
                    .
                  </>
                }
                checked={form.data.terms_consent}
                onChange={(e) => form.setData('terms_consent', e.target.checked)}
                error={form.errors.terms_consent}
              />
            </fieldset>

            <button
              type="submit"
              disabled={form.processing}
              className="self-start rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {form.processing
                ? t('marketing.forms.buttons.sending')
                : t('marketing.forms.buttons.submitCarrierSignup')}
            </button>
          </form>

          <aside className="h-fit rounded border border-steel-200 bg-navy-50 p-6">
            <h2 className="font-display text-lg font-bold text-navy-700">
              {t('marketing.carrierSignup.whatHappensNext.title')}
            </h2>
            <p className="mt-3 text-sm text-steel-700">
              {t('marketing.carrierSignup.whatHappensNext.intro')}
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {NEXT_STEPS.map((step) => (
                <li key={step} className="flex gap-3 text-sm text-steel-700">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-safety-600" />
                  <span>{t(`marketing.carrierSignup.whatHappensNext.${step}`)}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </Section>
    </MarketingLayout>
  )
}
