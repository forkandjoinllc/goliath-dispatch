'use client'

import { Controller, useFormContext } from 'react-hook-form'
import {
  Form,
  TextField,
  TextareaField,
  CheckboxField,
  SelectField,
  FormErrorSummary,
  FormField,
  useActionForm,
  type SelectFieldOption,
} from '@/components/forms'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { submitQuoteRequestAction } from '@/server/marketing/actions'
import { quoteFormSchema, type QuoteFormInput } from '@/server/marketing/schema'
import { stateCodeEnum } from '@/db/schema/_shared'
import { AntiSpamFields } from './anti-spam-fields'

const STATE_OPTIONS: SelectFieldOption[] = stateCodeEnum.enumValues.map((code) => ({
  value: code,
  label: code,
}))

/** Feet + inches pair for one dimension (length/width/height). */
function DimensionFields({
  name,
  label,
  feetLabel,
  inchesLabel,
}: {
  name: 'length' | 'width' | 'height'
  label: string
  feetLabel: string
  inchesLabel: string
}) {
  const { control } = useFormContext<QuoteFormInput>()
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium text-carbon">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <FormField<QuoteFormInput>
          name={`${name}.feet`}
          hideLabel
          label={feetLabel}
          render={(bind) => (
            <Controller
              control={control}
              name={`${name}.feet`}
              render={({ field }) => (
                <div className="relative">
                  <Input {...bind} {...field} value={field.value ?? ''} inputMode="numeric" placeholder="0" className="pr-9" />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-steel-500">
                    {feetLabel}
                  </span>
                </div>
              )}
            />
          )}
        />
        <FormField<QuoteFormInput>
          name={`${name}.inches`}
          hideLabel
          label={inchesLabel}
          render={(bind) => (
            <Controller
              control={control}
              name={`${name}.inches`}
              render={({ field }) => (
                <div className="relative">
                  <Input {...bind} {...field} value={field.value ?? ''} inputMode="numeric" placeholder="0" className="pr-9" />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-steel-500">
                    {inchesLabel}
                  </span>
                </div>
              )}
            />
          )}
        />
      </div>
    </div>
  )
}

export function QuoteForm() {
  const t = useTranslate()
  const { locale } = useI18n()

  const { form, onSubmit, isPending } = useActionForm({
    schema: quoteFormSchema,
    defaultValues: {
      contactName: '',
      email: '',
      phone: '',
      companyName: '',
      commodity: '',
      weightPounds: '' as unknown as number,
      length: { feet: '' as unknown as number, inches: '' as unknown as number },
      width: { feet: '' as unknown as number, inches: '' as unknown as number },
      height: { feet: '' as unknown as number, inches: '' as unknown as number },
      originCity: '',
      originState: '' as unknown as QuoteFormInput['originState'],
      destinationCity: '',
      destinationState: '' as unknown as QuoteFormInput['destinationState'],
      equipmentPreference: '',
      isOversizeSuspected: false,
      notes: '',
      locale,
      consent: false as unknown as true,
      hpField: '',
      renderedAt: 0,
    },
    action: submitQuoteRequestAction,
    successMessageKey: 'marketing.forms.success.quoteTitle',
  })

  return (
    <Form form={form} onSubmit={onSubmit} className="space-y-4">
      <FormErrorSummary title={t('errors.validationFailed')} />
      <AntiSpamFields hiddenLabel={t('marketing.forms.hpFieldLabel')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<QuoteFormInput> name="contactName" label={t('common.labels.name')} required autoComplete="name" />
        <TextField<QuoteFormInput> name="email" type="email" label={t('marketing.forms.labels.email')} required autoComplete="email" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<QuoteFormInput> name="phone" label={t('marketing.forms.labels.phone')} autoComplete="tel" />
        <TextField<QuoteFormInput> name="companyName" label={t('marketing.forms.labels.companyName')} autoComplete="organization" />
      </div>

      <TextField<QuoteFormInput>
        name="commodity"
        label={t('marketing.forms.labels.commodity')}
        placeholder={t('marketing.forms.placeholders.commodity')}
        required
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField<QuoteFormInput>
          name="weightPounds"
          label={t('marketing.forms.labels.weightPounds')}
          required
          render={(bind) => (
            <Controller
              control={form.control}
              name="weightPounds"
              render={({ field }) => (
                <Input {...bind} {...field} value={field.value ?? ''} inputMode="numeric" />
              )}
            />
          )}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <DimensionFields
          name="length"
          label={t('marketing.forms.labels.length')}
          feetLabel={t('marketing.forms.labels.feet')}
          inchesLabel={t('marketing.forms.labels.inches')}
        />
        <DimensionFields
          name="width"
          label={t('marketing.forms.labels.width')}
          feetLabel={t('marketing.forms.labels.feet')}
          inchesLabel={t('marketing.forms.labels.inches')}
        />
        <DimensionFields
          name="height"
          label={t('marketing.forms.labels.height')}
          feetLabel={t('marketing.forms.labels.feet')}
          inchesLabel={t('marketing.forms.labels.inches')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-2">
          <TextField<QuoteFormInput> name="originCity" label={t('marketing.forms.labels.originCity')} required />
          <SelectField<QuoteFormInput> name="originState" label={t('marketing.forms.labels.originState')} required options={STATE_OPTIONS} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TextField<QuoteFormInput> name="destinationCity" label={t('marketing.forms.labels.destinationCity')} required />
          <SelectField<QuoteFormInput> name="destinationState" label={t('marketing.forms.labels.destinationState')} required options={STATE_OPTIONS} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField<QuoteFormInput>
          name="readyDate"
          label={t('marketing.forms.labels.readyDate')}
          render={(bind) => (
            <Controller
              control={form.control}
              name="readyDate"
              render={({ field }) => (
                <Input
                  {...bind}
                  type="date"
                  value={field.value ? new Date(field.value).toISOString().slice(0, 10) : ''}
                  onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : undefined)}
                  onBlur={field.onBlur}
                />
              )}
            />
          )}
        />
        <TextField<QuoteFormInput>
          name="equipmentPreference"
          label={t('marketing.forms.labels.equipmentPreference')}
          placeholder={t('marketing.forms.placeholders.equipmentPreference')}
        />
      </div>

      <CheckboxField<QuoteFormInput> name="isOversizeSuspected" label={t('marketing.forms.labels.isOversizeSuspected')} />
      <TextareaField<QuoteFormInput> name="notes" label={t('marketing.forms.labels.notes')} rows={4} />
      <CheckboxField<QuoteFormInput> name="consent" label={t('marketing.forms.consent.leadConsent')} />

      <Button type="submit" variant="accent" size="lg" loading={isPending} loadingLabel={t('marketing.forms.buttons.sending')}>
        {t('marketing.forms.buttons.submitQuote')}
      </Button>
    </Form>
  )
}
