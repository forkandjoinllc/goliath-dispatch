import { useForm } from '@inertiajs/react'
import { AntiSpamFields } from '@/components/Form/AntiSpamFields'
import { CheckboxField, TextArea, TextField } from '@/components/Form/Field'
import { useI18n } from '@/lib/i18n'

interface LeadFormData {
  first_name: string
  last_name: string
  email: string
  phone: string
  company_name: string
  message: string
  lead_consent: boolean
  hp_field: string
  form_token: string
  [key: string]: string | boolean
}

export function LeadForm({ token, locale }: { token: string; locale: string }) {
  const { t } = useI18n()

  const form = useForm<LeadFormData>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    company_name: '',
    message: '',
    lead_consent: false,
    hp_field: '',
    form_token: token,
  })

  const label = (key: string) => t(`marketing.forms.labels.${key}`)

  if (form.wasSuccessful) {
    return (
      <div role="status" className="rounded border-l-4 border-safety-500 bg-navy-50 p-6">
        <h3 className="font-display text-lg font-bold text-navy-700">
          {t('marketing.forms.success.leadTitle')}
        </h3>
        <p className="mt-2 text-steel-700">{t('marketing.forms.success.leadBody')}</p>
      </div>
    )
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        form.post('/leads', { preserveScroll: true })
      }}
      className="relative flex flex-col gap-5"
    >
      <AntiSpamFields token={token} />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label={label('firstName')}
          required
          autoComplete="given-name"
          value={form.data.first_name}
          onChange={(e) => form.setData('first_name', e.target.value)}
          error={form.errors.first_name}
        />
        <TextField
          label={label('lastName')}
          required
          autoComplete="family-name"
          value={form.data.last_name}
          onChange={(e) => form.setData('last_name', e.target.value)}
          error={form.errors.last_name}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label={label('email')}
          type="email"
          required
          autoComplete="email"
          value={form.data.email}
          onChange={(e) => form.setData('email', e.target.value)}
          error={form.errors.email}
        />
        <TextField
          label={label('phone')}
          type="tel"
          autoComplete="tel"
          value={form.data.phone}
          onChange={(e) => form.setData('phone', e.target.value)}
          error={form.errors.phone}
        />
      </div>

      <TextField
        label={label('companyName')}
        autoComplete="organization"
        value={form.data.company_name}
        onChange={(e) => form.setData('company_name', e.target.value)}
        error={form.errors.company_name}
      />

      <TextArea
        label={label('message')}
        value={form.data.message}
        onChange={(e) => form.setData('message', e.target.value)}
        error={form.errors.message}
      />

      <CheckboxField
        label={
          <>
            {t('marketing.forms.consent.privacyConsentPrefix')}{' '}
            <a href={`/${locale}/privacy`} className="font-medium text-navy-700 underline">
              {t('nav.public.privacy')}
            </a>
            . {t('marketing.forms.consent.leadConsent')}
          </>
        }
        checked={form.data.lead_consent}
        onChange={(e) => form.setData('lead_consent', e.target.checked)}
        error={form.errors.lead_consent}
      />

      <button
        type="submit"
        disabled={form.processing}
        className="self-start rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {form.processing ? t('marketing.forms.buttons.sending') : t('marketing.forms.buttons.submitLead')}
      </button>
    </form>
  )
}
