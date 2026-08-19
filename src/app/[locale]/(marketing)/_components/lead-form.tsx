'use client'

import { usePathname } from 'next/navigation'
import { Form, TextField, TextareaField, CheckboxField, FormErrorSummary, useActionForm } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { submitLeadAction } from '@/server/marketing/actions'
import { leadFormSchema, type LeadFormInput } from '@/server/marketing/schema'
import { AntiSpamFields } from './anti-spam-fields'

/**
 * The lead-capture form used on the Contact page and, in its compact form,
 * inline elsewhere. Persists a `leads` row via `submitLeadAction` — see
 * `src/server/marketing/actions.ts` for the spam/rate-limit/notification
 * pipeline every submission goes through.
 */
export function LeadForm({ compact = false }: { compact?: boolean }) {
  const t = useTranslate()
  const { locale } = useI18n()
  const pathname = usePathname()

  const { form, onSubmit, isPending } = useActionForm({
    schema: leadFormSchema,
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      companyName: '',
      dotNumber: '',
      mcNumber: '',
      message: '',
      locale,
      // Zod's `z.literal(true)` (required consent) makes the field's TS type
      // literally `true`; the real starting value is unchecked. See the
      // matching note in quote-form.tsx / carrier-signup-form.tsx.
      consent: false as unknown as true,
      sourcePath: pathname ?? undefined,
      hpField: '',
      renderedAt: 0,
    },
    action: submitLeadAction,
    successMessageKey: 'marketing.forms.success.leadTitle',
  })

  return (
    <Form form={form} onSubmit={onSubmit} className="space-y-4">
      <FormErrorSummary title={t('errors.validationFailed')} />
      <AntiSpamFields hiddenLabel={t('marketing.forms.hpFieldLabel')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<LeadFormInput> name="firstName" label={t('marketing.forms.labels.firstName')} required autoComplete="given-name" />
        <TextField<LeadFormInput> name="lastName" label={t('marketing.forms.labels.lastName')} required autoComplete="family-name" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<LeadFormInput> name="email" type="email" label={t('marketing.forms.labels.email')} required autoComplete="email" />
        <TextField<LeadFormInput> name="phone" type="text" label={t('marketing.forms.labels.phone')} autoComplete="tel" />
      </div>
      {!compact ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField<LeadFormInput> name="companyName" label={t('marketing.forms.labels.companyName')} autoComplete="organization" />
          <TextField<LeadFormInput> name="dotNumber" label={t('marketing.forms.labels.dotNumber')} />
          <TextField<LeadFormInput> name="mcNumber" label={t('marketing.forms.labels.mcNumber')} />
        </div>
      ) : null}
      <TextareaField<LeadFormInput> name="message" label={t('marketing.forms.labels.message')} required rows={compact ? 3 : 5} />
      <CheckboxField<LeadFormInput> name="consent" label={t('marketing.forms.consent.leadConsent')} />
      <Button type="submit" variant="accent" size="lg" loading={isPending} loadingLabel={t('marketing.forms.buttons.sending')}>
        {t('marketing.forms.buttons.submitLead')}
      </Button>
    </Form>
  )
}
