'use client'

import * as React from 'react'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Controller } from 'react-hook-form'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary, FormField, useFormContext } from '@/components/forms/form'
import { TextField, TextareaField, SelectField, MaskedField, PhoneField } from '@/components/forms/fields'
import { DateOnlyField } from './date-only-field'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import { createDriverAction, updateDriverAction } from '@/server/drivers/actions'

const ENDORSEMENT_CODES = ['H', 'N', 'P', 'S', 'T', 'X'] as const
const RESTRICTION_CODES = ['L', 'Z', 'E', 'O', 'M', 'V'] as const

const schema = z.object({
  firstName: z.string().trim().min(1, 'validation.required').max(100),
  lastName: z.string().trim().min(1, 'validation.required').max(100),
  dateOfBirth: z.string().trim(),
  email: z.string().trim(),
  phone: z.string().trim(),
  preferredLocale: z.enum(['en', 'es']),
  licenseState: z.string().trim(),
  licenseNumber: z.string().trim().optional(),
  cdlClass: z.string().trim(),
  endorsements: z.array(z.string()),
  restrictions: z.array(z.string()),
  licenseExpiresAt: z.date().nullable(),
  medicalCardExpiresAt: z.date().nullable(),
  notes: z.string().trim(),
})

type DriverFormValues = z.infer<typeof schema>

function toStringOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function CodeChecklistField({ name, codes, labelPrefix }: { name: 'endorsements' | 'restrictions'; codes: readonly string[]; labelPrefix: string }) {
  const t = useTranslate()
  const { control } = useFormContext<DriverFormValues>()
  return (
    <FormField<DriverFormValues>
      name={name}
      label={t(`driver.fields.${name}`)}
      render={() => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <div className="grid gap-2 sm:grid-cols-2">
              {codes.map((code) => {
                const checked = (field.value ?? []).includes(code)
                const id = `${name}-${code}`
                return (
                  <div key={code} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={(next) => {
                        const current: string[] = field.value ?? []
                        field.onChange(next ? [...current, code] : current.filter((c) => c !== code))
                      }}
                    />
                    <Label htmlFor={id} className="font-normal">
                      {t(`${labelPrefix}.${code}`)}
                    </Label>
                  </div>
                )
              })}
            </div>
          )}
        />
      )}
    />
  )
}

export interface DriverFormProps {
  locale: string
  mode: 'create' | 'edit'
  driverId?: string
  licenseNumberMaskedDisplay?: string
  defaultValues?: Partial<DriverFormValues>
}

export function DriverForm({ locale, mode, driverId, licenseNumberMaskedDisplay, defaultValues }: DriverFormProps) {
  const t = useTranslate()
  const router = useRouter()

  const { form, onSubmit, isPending } = useActionForm<DriverFormValues, { id: string }>({
    schema,
    defaultValues: {
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      email: '',
      phone: '',
      preferredLocale: 'en',
      licenseState: '',
      licenseNumber: undefined,
      cdlClass: '',
      endorsements: [],
      restrictions: [],
      licenseExpiresAt: null,
      medicalCardExpiresAt: null,
      notes: '',
      ...defaultValues,
    },
    action: (values) => {
      const payload = {
        firstName: values.firstName,
        lastName: values.lastName,
        dateOfBirth: toStringOrNull(values.dateOfBirth),
        email: toStringOrNull(values.email),
        phone: toStringOrNull(values.phone),
        preferredLocale: values.preferredLocale,
        licenseState: toStringOrNull(values.licenseState),
        // `undefined` means "left masked, don't touch" — omitted from the
        // JSON payload entirely, matching `updateDriver`'s contract.
        licenseNumber: values.licenseNumber === undefined ? undefined : toStringOrNull(values.licenseNumber),
        cdlClass: toStringOrNull(values.cdlClass),
        endorsements: values.endorsements,
        restrictions: values.restrictions,
        licenseExpiresAt: values.licenseExpiresAt,
        medicalCardExpiresAt: values.medicalCardExpiresAt,
        notes: toStringOrNull(values.notes),
      }
      return mode === 'create' ? createDriverAction(payload) : updateDriverAction({ driverId: driverId!, ...payload })
    },
    onSuccess: (data) => {
      router.push(`/${locale}/app/drivers/${data.id}`)
      router.refresh()
    },
    successMessageKey: mode === 'create' ? 'common.actions.create' : 'common.actions.save',
  })

  return (
    <Form form={form} onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t(mode === 'create' ? 'driver.list.new' : 'driver.detail.edit')}</CardTitle>
          <CardDescription>{t('driver.approval.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FormErrorSummary title={t('errors.validationFailed')} />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="firstName" label={t('driver.fields.firstName')} required />
            <TextField name="lastName" label={t('driver.fields.lastName')} required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <DobField />
            <SelectField
              name="preferredLocale"
              label={t('driver.fields.preferredLocale')}
              required
              options={[
                { value: 'en', label: 'English' },
                { value: 'es', label: 'Español' },
              ]}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="email" label={t('driver.fields.email')} type="email" />
            <PhoneField name="phone" label={t('driver.fields.phone')} />
          </div>

          <div className="space-y-4 border-t border-steel-200 pt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField name="licenseState" label={t('driver.fields.licenseState')} />
              <SelectField
                name="cdlClass"
                label={t('driver.fields.cdlClass')}
                options={[
                  { value: 'A', label: t('driver.cdlClass.A') },
                  { value: 'B', label: t('driver.cdlClass.B') },
                  { value: 'C', label: t('driver.cdlClass.C') },
                ]}
              />
              <MaskedField
                name="licenseNumber"
                label={t('driver.fields.licenseNumber')}
                maskedDisplay={licenseNumberMaskedDisplay}
                replaceLabel={t('common.actions.edit')}
                cancelLabel={t('common.actions.cancel')}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <DateOnlyField name="licenseExpiresAt" label={t('driver.fields.licenseExpiresAt')} />
              <DateOnlyField name="medicalCardExpiresAt" label={t('driver.fields.medicalCardExpiresAt')} />
            </div>
            <CodeChecklistField name="endorsements" codes={ENDORSEMENT_CODES} labelPrefix="driver.endorsements" />
            <CodeChecklistField name="restrictions" codes={RESTRICTION_CODES} labelPrefix="driver.restrictions" />
          </div>

          <TextareaField name="notes" label={t('driver.fields.notes')} rows={4} />
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
            {t('common.actions.save')}
          </Button>
        </CardFooter>
      </Card>
    </Form>
  )
}

/**
 * Date of birth is stored as a plain `YYYY-MM-DD` string (matching the
 * Postgres `date` column and `CreateDriverInput.dateOfBirth: string | null`),
 * unlike the `Date`-valued expiry fields — hence its own tiny field here
 * instead of reusing `DateOnlyField`.
 */
function DobField() {
  const t = useTranslate()
  const { control } = useFormContext<DriverFormValues>()
  return (
    <FormField<DriverFormValues>
      name="dateOfBirth"
      label={t('driver.fields.dateOfBirth')}
      render={(bind) => (
        <Controller
          control={control}
          name="dateOfBirth"
          render={({ field }) => <Input {...bind} type="date" value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} />}
        />
      )}
    />
  )
}
