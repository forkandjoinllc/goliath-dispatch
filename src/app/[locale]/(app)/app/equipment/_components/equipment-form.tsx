'use client'

import * as React from 'react'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { Controller } from 'react-hook-form'
import { TextField, TextareaField, SelectField, CheckboxField, type SelectFieldOption } from '@/components/forms/fields'
import { FormField, useFormContext } from '@/components/forms/form'
import { DateOnlyField } from './date-only-field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert } from '@/components/ui/feedback'
import { useTranslate } from '@/components/providers/i18n-provider'
import { normalizeVin } from '@/lib/utils'
import { decodeVin } from '@/server/equipment/vin'
import { createTrailerAction, createTruckAction, updateTrailerAction, updateTruckAction } from '@/server/equipment/actions'

const baseFields = {
  carrierId: z.string().uuid('validation.required'),
  unitNumber: z.string().trim().min(1, 'validation.required').max(40),
  vin: z.string().trim().min(1, 'validation.required'),
  year: z.string().trim(),
  make: z.string().trim(),
  model: z.string().trim(),
  equipmentTypeId: z.string().trim(),
  plateNumber: z.string().trim(),
  plateState: z.string().trim(),
  registrationNumber: z.string().trim(),
  registrationExpiresAt: z.date().nullable(),
  lastInspectionAt: z.date().nullable(),
  nextInspectionDueAt: z.date().nullable(),
  lastMaintenanceAt: z.date().nullable(),
  nextMaintenanceDueAt: z.date().nullable(),
  notes: z.string().trim(),
}

const truckSchema = z.object(baseFields)

const trailerSchema = z.object({
  ...baseFields,
  lengthInches: z.string().trim(),
  widthInches: z.string().trim(),
  deckHeightInches: z.string().trim(),
  wellLengthInches: z.string().trim(),
  capacityPounds: z.string().trim(),
  axleCount: z.string().trim(),
  axleConfiguration: z.string().trim(),
  removableGooseneck: z.boolean(),
  isExtendable: z.boolean(),
})

type TrailerFormValues = z.infer<typeof trailerSchema>

function toIntOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? Math.round(n) : null
}

function toStringOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * VIN input rendered outside `TextField` because it needs to run the offline
 * decoder on blur — `TextField` has no blur hook to intercept. Uppercases as
 * typed since a VIN never contains lowercase letters.
 */
function VinField({ onDecodeBlur }: { onDecodeBlur: (value: string) => void }) {
  const t = useTranslate()
  const { control } = useFormContext<TrailerFormValues>()
  return (
    <FormField<TrailerFormValues>
      name="vin"
      label={t('equipment.fields.vin')}
      required
      render={(bind) => (
        <Controller
          control={control}
          name="vin"
          render={({ field }) => (
            <Input
              {...bind}
              {...field}
              value={field.value ?? ''}
              className="font-mono uppercase"
              maxLength={17}
              onChange={(event) => field.onChange(event.target.value.toUpperCase())}
              onBlur={(event) => {
                field.onBlur()
                onDecodeBlur(event.target.value)
              }}
            />
          )}
        />
      )}
    />
  )
}

export interface EquipmentFormProps {
  locale: string
  equipmentType: 'truck' | 'trailer'
  mode: 'create' | 'edit'
  equipmentId?: string
  carrierOptions: SelectFieldOption[]
  equipmentTypeOptions: SelectFieldOption[]
  defaultValues?: Partial<TrailerFormValues>
}

/**
 * Shared create/edit form for trucks and trailers. Trailer-only fields
 * (dimensions, axles, RGN/extendable flags) are rendered only when
 * `equipmentType === 'trailer'`; the payload sent to the server action omits
 * them entirely for trucks.
 */
export function EquipmentForm({
  locale,
  equipmentType,
  mode,
  equipmentId,
  carrierOptions,
  equipmentTypeOptions,
  defaultValues,
}: EquipmentFormProps) {
  const t = useTranslate()
  const router = useRouter()
  const schema = equipmentType === 'trailer' ? trailerSchema : truckSchema
  const [vinBanner, setVinBanner] = React.useState<
    { tone: 'success' | 'warning' | 'danger'; message: string } | null
  >(null)

  const basePath = `/${locale}/app/equipment/${equipmentType === 'truck' ? 'trucks' : 'trailers'}`

  const { form, onSubmit, isPending } = useActionForm<TrailerFormValues, { id: string }>({
    schema: schema as never,
    defaultValues: {
      carrierId: '',
      unitNumber: '',
      vin: '',
      year: '',
      make: '',
      model: '',
      equipmentTypeId: '',
      plateNumber: '',
      plateState: '',
      registrationNumber: '',
      registrationExpiresAt: null,
      lastInspectionAt: null,
      nextInspectionDueAt: null,
      lastMaintenanceAt: null,
      nextMaintenanceDueAt: null,
      notes: '',
      lengthInches: '',
      widthInches: '',
      deckHeightInches: '',
      wellLengthInches: '',
      capacityPounds: '',
      axleCount: '',
      axleConfiguration: '',
      removableGooseneck: false,
      isExtendable: false,
      ...defaultValues,
    },
    action: (values) => {
      const shared = {
        carrierId: values.carrierId,
        unitNumber: values.unitNumber,
        vin: values.vin,
        year: toIntOrNull(values.year),
        make: toStringOrNull(values.make),
        model: toStringOrNull(values.model),
        equipmentTypeId: toStringOrNull(values.equipmentTypeId),
        plateNumber: toStringOrNull(values.plateNumber),
        plateState: toStringOrNull(values.plateState),
        registrationNumber: toStringOrNull(values.registrationNumber),
        registrationExpiresAt: values.registrationExpiresAt,
        lastInspectionAt: values.lastInspectionAt,
        nextInspectionDueAt: values.nextInspectionDueAt,
        lastMaintenanceAt: values.lastMaintenanceAt,
        nextMaintenanceDueAt: values.nextMaintenanceDueAt,
        notes: toStringOrNull(values.notes),
      }

      if (equipmentType === 'truck') {
        return mode === 'create'
          ? createTruckAction(shared)
          : updateTruckAction({ truckId: equipmentId!, ...shared })
      }

      const trailerOnly = {
        lengthInches: toIntOrNull(values.lengthInches),
        widthInches: toIntOrNull(values.widthInches),
        deckHeightInches: toIntOrNull(values.deckHeightInches),
        wellLengthInches: toIntOrNull(values.wellLengthInches),
        capacityPounds: toIntOrNull(values.capacityPounds),
        axleCount: toIntOrNull(values.axleCount),
        axleConfiguration: toStringOrNull(values.axleConfiguration),
        removableGooseneck: values.removableGooseneck,
        isExtendable: values.isExtendable,
      }
      return mode === 'create'
        ? createTrailerAction({ ...shared, ...trailerOnly })
        : updateTrailerAction({ trailerId: equipmentId!, ...shared, ...trailerOnly })
    },
    onSuccess: (data) => {
      router.push(`${basePath}/${data.id}`)
      router.refresh()
    },
    successMessageKey: mode === 'create' ? 'common.actions.create' : 'common.actions.save',
  })

  function handleVinBlur(rawValue: string) {
    const normalized = normalizeVin(rawValue)
    if (normalized.length !== 17) {
      setVinBanner(null)
      return
    }
    form.setValue('vin' as never, normalized as never, { shouldValidate: true })
    const decoded = decodeVin(normalized)
    if (!decoded.valid) {
      setVinBanner({ tone: 'danger', message: t('equipment.vin.invalidFormat') })
      return
    }
    if (!decoded.checkDigitValid) {
      setVinBanner({ tone: 'warning', message: t('equipment.vin.checkDigitInvalid') })
      return
    }
    let usedDecode = false
    if (!form.getValues('year' as never)) {
      if (decoded.year != null) {
        form.setValue('year' as never, String(decoded.year) as never)
        usedDecode = true
      }
    }
    if (!form.getValues('make' as never)) {
      if (decoded.make) {
        form.setValue('make' as never, decoded.make as never)
        usedDecode = true
      }
    }
    setVinBanner(
      usedDecode
        ? { tone: 'success', message: t('equipment.vin.decodedBanner') }
        : decoded.make
          ? null
          : { tone: 'warning', message: t('equipment.vin.decodeNoMatch') },
    )
  }

  return (
    <Form form={form} onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {t(
              mode === 'create'
                ? equipmentType === 'truck'
                  ? 'equipment.trucks.new'
                  : 'equipment.trailers.new'
                : equipmentType === 'truck'
                  ? 'equipment.trucks.edit'
                  : 'equipment.trailers.edit',
            )}
          </CardTitle>
          <CardDescription>{t('equipment.vin.helpText')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FormErrorSummary title={t('errors.validationFailed')} />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField name="carrierId" label={t('equipment.fields.carrier')} required options={carrierOptions} />
            <SelectField
              name="equipmentTypeId"
              label={t('equipment.fields.equipmentType')}
              options={equipmentTypeOptions}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="unitNumber" label={t('equipment.fields.unitNumber')} required />
            <div className="space-y-1.5">
              <VinField onDecodeBlur={handleVinBlur} />
              {vinBanner ? (
                <Alert tone={vinBanner.tone === 'danger' ? 'danger' : vinBanner.tone === 'warning' ? 'warning' : 'info'}>
                  {vinBanner.message}
                </Alert>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <TextField name="year" label={t('equipment.fields.year')} />
            <TextField name="make" label={t('equipment.fields.make')} />
            <TextField name="model" label={t('equipment.fields.model')} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="plateNumber" label={t('equipment.fields.plateNumber')} />
            <TextField name="plateState" label={t('equipment.fields.plateState')} />
          </div>

          {equipmentType === 'trailer' ? (
            <div className="space-y-4 border-t border-steel-200 pt-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <TextField name="lengthInches" label={t('equipment.fields.lengthInches')} />
                <TextField name="widthInches" label={t('equipment.fields.widthInches')} />
                <TextField name="deckHeightInches" label={t('equipment.fields.deckHeightInches')} />
                <TextField name="wellLengthInches" label={t('equipment.fields.wellLengthInches')} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField name="capacityPounds" label={t('equipment.fields.capacityPounds')} />
                <TextField name="axleCount" label={t('equipment.fields.axleCount')} />
                <TextField name="axleConfiguration" label={t('equipment.fields.axleConfiguration')} />
              </div>
              <div className="flex flex-wrap gap-6">
                <CheckboxField name="removableGooseneck" label={t('equipment.fields.removableGooseneck')} />
                <CheckboxField name="isExtendable" label={t('equipment.fields.isExtendable')} />
              </div>
            </div>
          ) : null}

          <div className="space-y-4 border-t border-steel-200 pt-4">
            <TextField name="registrationNumber" label={t('equipment.fields.registrationNumber')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <DateOnlyField name="registrationExpiresAt" label={t('equipment.fields.registrationExpiresAt')} />
              <DateOnlyField name="nextInspectionDueAt" label={t('equipment.fields.nextInspectionDueAt')} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <DateOnlyField name="lastInspectionAt" label={t('equipment.fields.lastInspectionAt')} />
              <DateOnlyField name="lastMaintenanceAt" label={t('equipment.fields.lastMaintenanceAt')} />
            </div>
            <DateOnlyField name="nextMaintenanceDueAt" label={t('equipment.fields.nextMaintenanceDueAt')} />
          </div>

          <TextareaField name="notes" label={t('equipment.fields.notes')} rows={4} />
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
