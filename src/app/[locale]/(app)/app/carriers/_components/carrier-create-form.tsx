'use client'

import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import {
  TextField,
  TextareaField,
  PhoneField,
  MaskedField,
  PercentField,
  CheckboxField,
  SelectField,
} from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { stateCodeEnum } from '@/db/schema/_shared'
import { createCarrierAction } from '@/server/carriers/actions'

const STATE_OPTIONS = stateCodeEnum.enumValues.map((code) => ({ value: code, label: code }))
const LOCALE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

const schema = z.object({
  legalName: z.string().trim().min(1, 'validation.required').max(200),
  dba: z.string().trim().max(200).optional(),
  dotNumber: z.string().trim().min(1, 'validation.required'),
  mcNumber: z.string().trim().optional(),
  ein: z.string().trim().min(1, 'validation.required'),
  contactFirstName: z.string().trim().min(1, 'validation.required').max(100),
  contactLastName: z.string().trim().min(1, 'validation.required').max(100),
  email: z.string().trim().min(1, 'validation.required'),
  phone: z.string().trim().min(1, 'validation.required'),
  website: z.string().trim().optional(),
  preferredLocale: z.enum(['en', 'es']),
  physicalLine1: z.string().trim().optional(),
  physicalLine2: z.string().trim().optional(),
  physicalCity: z.string().trim().optional(),
  physicalState: z.string().trim().optional(),
  physicalPostalCode: z.string().trim().optional(),
  mailingSameAsPhysical: z.boolean(),
  mailingLine1: z.string().trim().optional(),
  mailingLine2: z.string().trim().optional(),
  mailingCity: z.string().trim().optional(),
  mailingState: z.string().trim().optional(),
  mailingPostalCode: z.string().trim().optional(),
  usesFactoring: z.boolean(),
  dispatchFeeBps: z.number().int().min(0).max(10_000).nullable(),
  notes: z.string().trim().optional(),
})

type FormValues = z.infer<typeof schema>

function toStringOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export function CarrierCreateForm({ locale }: { locale: string }) {
  const t = useTranslate()
  const router = useRouter()

  const { form, onSubmit, isPending } = useActionForm<FormValues, { carrier: { id: string } }>({
    schema,
    defaultValues: {
      legalName: '',
      dba: '',
      dotNumber: '',
      mcNumber: '',
      ein: '',
      contactFirstName: '',
      contactLastName: '',
      email: '',
      phone: '',
      website: '',
      preferredLocale: 'en',
      physicalLine1: '',
      physicalLine2: '',
      physicalCity: '',
      physicalState: '',
      physicalPostalCode: '',
      mailingSameAsPhysical: true,
      mailingLine1: '',
      mailingLine2: '',
      mailingCity: '',
      mailingState: '',
      mailingPostalCode: '',
      usesFactoring: false,
      dispatchFeeBps: 1000,
      notes: '',
    },
    action: (values) =>
      createCarrierAction({
        legalName: values.legalName,
        dba: toStringOrNull(values.dba),
        dotNumber: values.dotNumber,
        mcNumber: toStringOrNull(values.mcNumber) ?? undefined,
        ein: values.ein,
        contactFirstName: values.contactFirstName,
        contactLastName: values.contactLastName,
        email: values.email,
        phone: values.phone,
        website: toStringOrNull(values.website),
        preferredLocale: values.preferredLocale,
        physicalLine1: toStringOrNull(values.physicalLine1),
        physicalLine2: toStringOrNull(values.physicalLine2),
        physicalCity: toStringOrNull(values.physicalCity),
        physicalState: toStringOrNull(values.physicalState) ?? undefined,
        physicalPostalCode: toStringOrNull(values.physicalPostalCode) ?? undefined,
        mailingSameAsPhysical: values.mailingSameAsPhysical,
        mailingLine1: toStringOrNull(values.mailingLine1),
        mailingLine2: toStringOrNull(values.mailingLine2),
        mailingCity: toStringOrNull(values.mailingCity),
        mailingState: toStringOrNull(values.mailingState) ?? undefined,
        mailingPostalCode: toStringOrNull(values.mailingPostalCode) ?? undefined,
        usesFactoring: values.usesFactoring,
        dispatchFeeBps: values.dispatchFeeBps ?? undefined,
        notes: toStringOrNull(values.notes),
      }),
    onSuccess: (data) => {
      router.push(`/${locale}/app/carriers/${data.carrier.id}`)
      router.refresh()
    },
    successMessageKey: 'common.actions.create',
  })

  const mailingSame = form.watch('mailingSameAsPhysical' as never)

  return (
    <Form form={form} onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('carrier.actions.create')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <FormErrorSummary title={t('errors.validationFailed')} />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="legalName" label={t('carrier.fields.legalName')} required />
            <TextField name="dba" label={t('carrier.fields.dba')} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <TextField name="dotNumber" label={t('carrier.fields.dotNumber')} required />
            <TextField name="mcNumber" label={t('carrier.fields.mcNumber')} />
            <MaskedField name="ein" label={t('carrier.fields.ein')} replaceLabel={t('common.actions.edit')} cancelLabel={t('common.actions.cancel')} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="contactFirstName" label={t('carrier.fields.contactFirstName')} required />
            <TextField name="contactLastName" label={t('carrier.fields.contactLastName')} required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="email" label={t('carrier.fields.email')} required />
            <PhoneField name="phone" label={t('carrier.fields.phone')} required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="website" label={t('carrier.fields.website')} />
            <SelectField name="preferredLocale" label={t('carrier.fields.preferredLocale')} required options={LOCALE_OPTIONS} />
          </div>

          <div className="space-y-3 border-t border-steel-200 pt-4">
            <h3 className="text-sm font-bold text-carbon">{t('carrier.fields.physicalAddress')}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="physicalLine1" label={t('carrier.fields.physicalAddress')} />
              <TextField name="physicalLine2" label={t('common.labels.address')} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField name="physicalCity" label={t('common.labels.city')} />
              <SelectField name="physicalState" label={t('common.labels.state')} options={STATE_OPTIONS} />
              <TextField name="physicalPostalCode" label={t('common.labels.postalCode')} />
            </div>
          </div>

          <div className="space-y-3 border-t border-steel-200 pt-4">
            <CheckboxField name="mailingSameAsPhysical" label={t('carrier.fields.mailingSameAsPhysical')} />
            {!mailingSame ? (
              <>
                <h3 className="text-sm font-bold text-carbon">{t('carrier.fields.mailingAddress')}</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField name="mailingLine1" label={t('carrier.fields.mailingAddress')} />
                  <TextField name="mailingLine2" label={t('common.labels.address')} />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField name="mailingCity" label={t('common.labels.city')} />
                  <SelectField name="mailingState" label={t('common.labels.state')} options={STATE_OPTIONS} />
                  <TextField name="mailingPostalCode" label={t('common.labels.postalCode')} />
                </div>
              </>
            ) : null}
          </div>

          <div className="grid gap-4 border-t border-steel-200 pt-4 sm:grid-cols-2">
            <PercentField name="dispatchFeeBps" label={t('carrier.fields.dispatchFeeBps')} />
            <div className="flex items-center">
              <CheckboxField name="usesFactoring" label={t('carrier.fields.usesFactoring')} />
            </div>
          </div>

          <TextareaField name="notes" label={t('carrier.fields.notes')} />
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.push(`/${locale}/app/carriers`)}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="submit" disabled={isPending} loading={isPending}>
            {t('common.actions.create')}
          </Button>
        </CardFooter>
      </Card>
    </Form>
  )
}
