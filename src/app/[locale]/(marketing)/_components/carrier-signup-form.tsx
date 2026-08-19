'use client'

import * as React from 'react'
import Link from 'next/link'
import { Controller, useFormContext } from 'react-hook-form'
import {
  Form,
  TextField,
  SelectField,
  CheckboxField,
  FormErrorSummary,
  useActionForm,
} from '@/components/forms'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2 } from 'lucide-react'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { LOCALES, LOCALE_LABELS } from '@/i18n/config'
import { submitCarrierSignupAction } from '@/server/marketing/actions'
import { carrierSignupFormSchema, type CarrierSignupFormInput } from '@/server/marketing/schema'
import { stateCodeEnum } from '@/db/schema/_shared'
import { AntiSpamFields } from './anti-spam-fields'
import { localePath } from '../_lib/site'

const STATE_OPTIONS = stateCodeEnum.enumValues.map((code) => ({ value: code, label: code }))

function AddressFields({ prefix }: { prefix: 'physicalAddress' | 'mailingAddress' }) {
  const t = useTranslate()
  return (
    <div className="grid gap-4">
      <TextField<CarrierSignupFormInput> name={`${prefix}.line1`} label={t('marketing.forms.labels.addressLine1')} required />
      <TextField<CarrierSignupFormInput> name={`${prefix}.line2`} label={t('marketing.forms.labels.addressLine2')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField<CarrierSignupFormInput> name={`${prefix}.city`} label={t('marketing.forms.labels.city')} required />
        <SelectField<CarrierSignupFormInput> name={`${prefix}.state`} label={t('marketing.forms.labels.state')} required options={STATE_OPTIONS} />
        <TextField<CarrierSignupFormInput> name={`${prefix}.postalCode`} label={t('marketing.forms.labels.postalCode')} required />
      </div>
    </div>
  )
}

function ConsentRow({
  name,
  linkLabel,
  linkHref,
  restLabel,
}: {
  name: 'privacyConsent' | 'termsConsent'
  linkLabel: string
  linkHref: string
  restLabel: string
}) {
  const { control } = useFormContext<CarrierSignupFormInput>()
  const id = React.useId()
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="flex items-start gap-2">
          <Checkbox
            id={id}
            checked={Boolean(field.value)}
            onCheckedChange={field.onChange}
            invalid={Boolean(fieldState.error)}
            className="mt-0.5"
          />
          <Label htmlFor={id} className="font-normal">
            {restLabel}{' '}
            <Link href={linkHref} target="_blank" className="text-navy-700 underline underline-offset-2">
              {linkLabel}
            </Link>
          </Label>
        </div>
      )}
    />
  )
}

export function CarrierSignupForm() {
  const t = useTranslate()
  const { locale } = useI18n()
  const [submitted, setSubmitted] = React.useState(false)

  const { form, onSubmit, isPending } = useActionForm({
    schema: carrierSignupFormSchema,
    defaultValues: {
      legalName: '',
      dba: '',
      contactFirstName: '',
      contactLastName: '',
      email: '',
      phone: '',
      dotNumber: '',
      mcNumber: '',
      ein: '',
      physicalAddress: { line1: '', line2: '', city: '', state: '' as unknown as never, postalCode: '' },
      mailingSameAsPhysical: true,
      mailingAddress: { line1: '', line2: '', city: '', state: '' as unknown as never, postalCode: '' },
      website: '',
      preferredLocale: locale,
      factoringApplies: false,
      privacyConsent: false as unknown as true,
      termsConsent: false as unknown as true,
      hpField: '',
      renderedAt: 0,
    },
    action: submitCarrierSignupAction,
    onSuccess: () => setSubmitted(true),
  })

  const mailingSame = form.watch('mailingSameAsPhysical')

  if (submitted) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <CheckCircle2 className="size-12 text-success-500" aria-hidden="true" />
          <h2 className="text-2xl font-bold">{t('marketing.carrierSignup.success.title')}</h2>
          <p className="text-steel-600">{t('marketing.carrierSignup.success.body')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Form form={form} onSubmit={onSubmit} className="space-y-10">
      <FormErrorSummary title={t('errors.validationFailed')} />
      <AntiSpamFields hiddenLabel={t('marketing.forms.hpFieldLabel')} />

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('marketing.carrierSignup.sections.companyInfo')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField<CarrierSignupFormInput> name="legalName" label={t('marketing.forms.labels.legalName')} required />
            <TextField<CarrierSignupFormInput> name="dba" label={t('marketing.forms.labels.dba')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField<CarrierSignupFormInput> name="dotNumber" label={t('marketing.forms.labels.dotNumber')} required />
            <TextField<CarrierSignupFormInput> name="mcNumber" label={t('marketing.forms.labels.mcNumber')} />
            <TextField<CarrierSignupFormInput> name="ein" label={t('marketing.forms.labels.ein')} />
          </div>
          <TextField<CarrierSignupFormInput> name="website" type="url" label={t('marketing.forms.labels.website')} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('marketing.carrierSignup.sections.contactInfo')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField<CarrierSignupFormInput> name="contactFirstName" label={t('marketing.forms.labels.contactFirstName')} required autoComplete="given-name" />
            <TextField<CarrierSignupFormInput> name="contactLastName" label={t('marketing.forms.labels.contactLastName')} required autoComplete="family-name" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField<CarrierSignupFormInput> name="email" type="email" label={t('marketing.forms.labels.email')} required autoComplete="email" />
            <TextField<CarrierSignupFormInput> name="phone" label={t('marketing.forms.labels.phone')} required autoComplete="tel" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('marketing.carrierSignup.sections.addresses')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm font-semibold text-carbon">{t('marketing.forms.labels.physicalAddress')}</p>
          <AddressFields prefix="physicalAddress" />
          <CheckboxField<CarrierSignupFormInput> name="mailingSameAsPhysical" label={t('marketing.forms.labels.mailingSameAsPhysical')} />
          {!mailingSame ? (
            <>
              <p className="text-sm font-semibold text-carbon">{t('marketing.forms.labels.mailingAddress')}</p>
              <AddressFields prefix="mailingAddress" />
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('marketing.carrierSignup.sections.preferences')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <SelectField<CarrierSignupFormInput>
            name="preferredLocale"
            label={t('marketing.forms.labels.preferredLanguage')}
            required
            options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))}
          />
          <div className="flex items-end pb-1">
            <CheckboxField<CarrierSignupFormInput> name="factoringApplies" label={t('marketing.forms.labels.factoringApplies')} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('marketing.carrierSignup.sections.consent')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ConsentRow
            name="privacyConsent"
            restLabel={t('marketing.forms.consent.privacyConsentPrefix')}
            linkLabel={t('nav.public.privacy')}
            linkHref={localePath(locale, 'privacy')}
          />
          <ConsentRow
            name="termsConsent"
            restLabel={t('marketing.forms.consent.termsConsentPrefix')}
            linkLabel={t('nav.public.terms')}
            linkHref={localePath(locale, 'terms')}
          />
        </CardContent>
      </Card>

      <Button type="submit" variant="accent" size="lg" loading={isPending} loadingLabel={t('marketing.forms.buttons.sending')}>
        {t('marketing.forms.buttons.submitCarrierSignup')}
      </Button>
    </Form>
  )
}
