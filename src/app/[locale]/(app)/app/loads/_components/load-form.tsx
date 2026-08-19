'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { useFieldArray, Controller } from 'react-hook-form'
import { Plus, Trash2 } from 'lucide-react'
import { useActionForm, type ActionResultLike } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary, FormField, useFormContext } from '@/components/forms/form'
import {
  TextField,
  TextareaField,
  PhoneField,
  SelectField,
  MoneyField,
  PercentField,
  DateTimeField,
  AddressField,
  type AddressSuggestion,
} from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatMoney, formatBps, formatInches, formatPounds } from '@/i18n/translate'
import { stateCodeEnum } from '@/db/schema/_shared'
import type { EquipmentType, Load } from '@/db/schema'
import { buildDateTimePickerLabels } from './datetime-picker-labels'
import { createLoadAction, stopAddressAutocompleteAction, updateLoadAction } from '@/server/loads/actions'
import { customerAutocompleteAction } from '@/server/customers/actions'

const STATE_OPTIONS = stateCodeEnum.enumValues.map((code) => ({ value: code, label: code }))

const addressGroupSchema = z.object({
  line1: z.string().trim(),
  line2: z.string().trim().optional(),
  city: z.string().trim(),
  state: z.string().trim(),
  postalCode: z.string().trim(),
})

const stopFormSchema = z.object({
  stopType: z.enum(['pickup', 'delivery']),
  facilityName: z.string().trim(),
  address: addressGroupSchema,
  contactName: z.string().trim(),
  contactPhone: z.string().trim(),
  contactEmail: z.string().trim(),
  confirmationNumber: z.string().trim(),
  instructions: z.string().trim(),
  appointmentType: z.enum(['exact', 'window', 'fcfs', 'open']),
  // `DateTimeField` binds to a UTC ISO string (or null), never a `Date`.
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
})
type StopFormValues = z.infer<typeof stopFormSchema>

const baseSchema = z.object({
  customerId: z.string().trim().min(1, 'validation.required'),
  customerName: z.string().trim(),
  customerContactId: z.string().trim().optional(),
  customerReference: z.string().trim(),
  poNumber: z.string().trim(),
  commodity: z.string().trim(),
  weightPounds: z.number().nullable(),
  lengthInches: z.number().nullable(),
  widthInches: z.number().nullable(),
  heightInches: z.number().nullable(),
  pieceCount: z.number().nullable(),
  requiredEquipmentTypeId: z.string().trim(),
  axleConfiguration: z.string().trim(),
  grossVehicleWeightPounds: z.number().nullable(),
  specialInstructions: z.string().trim(),
  internalNotes: z.string().trim(),
  customerChargeCents: z.number().nullable(),
  carrierGrossRateCents: z.number().nullable(),
  carrierDispatchFeeBps: z.number().nullable(),
  dispatcherCommissionBps: z.number().nullable(),
  dispatcherCommissionBasis: z.enum(['dispatch_fee_amount', 'carrier_gross_rate', 'commissionable_base']),
})

/**
 * `createLoad` throws `load.errors.stopsRequired` when the stop list has no
 * pickup or no delivery — this mirrors that invariant client-side so "Save
 * draft" fails fast with an inline error instead of a round trip.
 */
function buildSchema(mode: 'create' | 'edit') {
  if (mode === 'edit') return baseSchema
  return baseSchema
    .extend({ stops: z.array(stopFormSchema) })
    .superRefine((value, ctx) => {
      const hasPickup = value.stops.some((s) => s.stopType === 'pickup')
      const hasDelivery = value.stops.some((s) => s.stopType === 'delivery')
      if (!hasPickup || !hasDelivery) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'load.errors.stopsRequired', path: ['stops'] })
      }
    })
}

type CreateFormValues = z.infer<typeof baseSchema> & { stops: StopFormValues[] }
type FormValues = CreateFormValues

function toNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

async function fetchAddressSuggestions(query: string): Promise<AddressSuggestion[]> {
  const result = await stopAddressAutocompleteAction({ query })
  if (!result.ok) return []
  return result.data.map((s) => ({ id: s.id, label: s.label, line1: s.line1, line2: s.line2, city: s.city, state: s.state, postalCode: s.postalCode }))
}

const blankStop: StopFormValues = {
  stopType: 'pickup',
  facilityName: '',
  address: { line1: '', line2: '', city: '', state: '', postalCode: '' },
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  confirmationNumber: '',
  instructions: '',
  appointmentType: 'window',
  windowStart: null,
  windowEnd: null,
}

/** Generic controlled numeric input for fields that submit `number | null`, not a string. */
function IntegerField({ name, label, min = 0 }: { name: keyof FormValues; label: string; min?: number }) {
  const { control } = useFormContext<FormValues>()
  return (
    <FormField<FormValues>
      name={name as never}
      label={label}
      render={(bind) => (
        <Controller
          control={control}
          name={name as never}
          render={({ field }) => (
            <Input
              {...bind}
              type="number"
              min={min}
              inputMode="numeric"
              value={(field.value as number | null) ?? ''}
              onChange={(event) => field.onChange(event.target.value === '' ? null : Number(event.target.value))}
              onBlur={field.onBlur}
            />
          )}
        />
      )}
    />
  )
}

export interface LoadFormProps {
  locale: string
  mode: 'create' | 'edit'
  load?: Load
  initialCustomer?: { id: string; companyName: string } | null
  equipmentTypes: EquipmentType[]
}

const CREATE_STEPS = ['customer', 'stops', 'freight', 'equipment', 'financials', 'review'] as const
const EDIT_STEPS = ['customer', 'freight', 'equipment', 'financials', 'review'] as const

export function LoadForm({ locale, mode, load, initialCustomer, equipmentTypes }: LoadFormProps) {
  const t = useTranslate()
  const router = useRouter()
  const { locale: i18nLocale, timezone } = useI18n()
  const steps = mode === 'create' ? CREATE_STEPS : EDIT_STEPS
  const [stepIndex, setStepIndex] = React.useState(0)
  const [customerQuery, setCustomerQuery] = React.useState('')
  const [selectedCustomer, setSelectedCustomer] = React.useState<{ id: string; label: string } | null>(
    initialCustomer ? { id: initialCustomer.id, label: initialCustomer.companyName } : null,
  )

  const schema = React.useMemo(() => buildSchema(mode), [mode])

  const { form, onSubmit, isPending } = useActionForm<FormValues, { id: string }>({
    schema: schema as never,
    defaultValues: {
      customerId: load?.customerId ?? '',
      customerName: initialCustomer?.companyName ?? '',
      customerContactId: load?.customerContactId ?? undefined,
      customerReference: load?.customerReference ?? '',
      poNumber: load?.poNumber ?? '',
      stops: [{ ...blankStop, stopType: 'pickup' }, { ...blankStop, stopType: 'delivery' }],
      commodity: load?.commodity ?? '',
      weightPounds: load?.weightPounds ?? null,
      lengthInches: load?.lengthInches ?? null,
      widthInches: load?.widthInches ?? null,
      heightInches: load?.heightInches ?? null,
      pieceCount: load?.pieceCount ?? null,
      requiredEquipmentTypeId: load?.requiredEquipmentTypeId ?? '',
      axleConfiguration: load?.axleConfiguration ?? '',
      grossVehicleWeightPounds: load?.grossVehicleWeightPounds ?? null,
      specialInstructions: load?.specialInstructions ?? '',
      internalNotes: load?.internalNotes ?? '',
      customerChargeCents: load?.customerChargeCents ?? null,
      carrierGrossRateCents: load?.carrierGrossRateCents ?? null,
      carrierDispatchFeeBps: load?.carrierDispatchFeeBps ?? null,
      dispatcherCommissionBps: load?.dispatcherCommissionBps ?? null,
      dispatcherCommissionBasis: (load?.dispatcherCommissionBasis as FormValues['dispatcherCommissionBasis']) ?? 'dispatch_fee_amount',
    } as FormValues,
    action: async (values): Promise<ActionResultLike<{ id: string }>> => {
      const shared = {
        customerReference: toNullable(values.customerReference),
        poNumber: toNullable(values.poNumber),
        commodity: toNullable(values.commodity),
        weightPounds: values.weightPounds,
        lengthInches: values.lengthInches,
        widthInches: values.widthInches,
        heightInches: values.heightInches,
        pieceCount: values.pieceCount,
        requiredEquipmentTypeId: toNullable(values.requiredEquipmentTypeId),
        axleConfiguration: toNullable(values.axleConfiguration),
        grossVehicleWeightPounds: values.grossVehicleWeightPounds,
        specialInstructions: toNullable(values.specialInstructions),
        internalNotes: toNullable(values.internalNotes),
        customerChargeCents: values.customerChargeCents ?? undefined,
        carrierGrossRateCents: values.carrierGrossRateCents ?? undefined,
        carrierDispatchFeeBps: values.carrierDispatchFeeBps ?? undefined,
        dispatcherCommissionBps: values.dispatcherCommissionBps ?? undefined,
        dispatcherCommissionBasis: values.dispatcherCommissionBasis,
      }

      if (mode === 'edit' && load) {
        const result = await updateLoadAction({
          loadId: load.id,
          customerId: values.customerId || undefined,
          customerContactId: toNullable(values.customerContactId ?? ''),
          ...shared,
        })
        if (!result.ok) return result
        return { ok: true, data: { id: result.data.id } }
      }

      const result = await createLoadAction({
        customerId: values.customerId,
        customerContactId: toNullable(values.customerContactId ?? ''),
        ...shared,
        stops: values.stops.map((stop) => ({
          stopType: stop.stopType,
          facilityName: toNullable(stop.facilityName),
          line1: toNullable(stop.address.line1),
          line2: toNullable(stop.address.line2 ?? ''),
          city: toNullable(stop.address.city),
          state: toNullable(stop.address.state),
          postalCode: toNullable(stop.address.postalCode),
          contactName: toNullable(stop.contactName),
          contactPhone: toNullable(stop.contactPhone),
          contactEmail: toNullable(stop.contactEmail),
          confirmationNumber: toNullable(stop.confirmationNumber),
          instructions: toNullable(stop.instructions),
          appointmentType: stop.appointmentType,
          windowStart: stop.windowStart,
          windowEnd: stop.windowEnd,
        })),
      })
      if (!result.ok) return result
      return { ok: true, data: { id: result.data.load.id } }
    },
    onSuccess: (data) => {
      router.push(`/${locale}/app/loads/${data.id}`)
      router.refresh()
    },
    successMessageKey: mode === 'create' ? 'load.new.submit' : 'load.edit.submit',
  })

  const stopsArray = useFieldArray<FormValues, 'stops'>({ control: form.control, name: 'stops' })

  const stepFieldsByKey: Record<(typeof CREATE_STEPS)[number], (keyof FormValues)[]> = {
    customer: ['customerId'],
    stops: ['stops'],
    freight: ['weightPounds', 'lengthInches', 'widthInches', 'heightInches', 'pieceCount', 'commodity'],
    equipment: ['requiredEquipmentTypeId', 'axleConfiguration', 'grossVehicleWeightPounds'],
    financials: ['customerChargeCents', 'carrierGrossRateCents', 'carrierDispatchFeeBps', 'dispatcherCommissionBps', 'dispatcherCommissionBasis'],
    review: [],
  }

  const currentStepKey = steps[stepIndex]!
  const isLastStep = stepIndex === steps.length - 1

  async function handleNext() {
    const fields = stepFieldsByKey[currentStepKey]
    const valid = fields.length === 0 ? true : await form.trigger(fields as never)
    if (valid) setStepIndex((i) => Math.min(i + 1, steps.length - 1))
  }

  function handleBack() {
    setStepIndex((i) => Math.max(i - 1, 0))
  }

  const values = form.watch()

  const reviewItems: DetailItem[] = [
    { key: 'customer', label: t('load.fields.customer'), value: selectedCustomer?.label ?? t('common.labels.none') },
    { key: 'customerReference', label: t('load.fields.customerReference'), value: values.customerReference || t('common.labels.none') },
    { key: 'poNumber', label: t('load.fields.poNumber'), value: values.poNumber || t('common.labels.none') },
    { key: 'commodity', label: t('load.fields.commodity'), value: values.commodity || t('common.labels.none') },
    { key: 'weightPounds', label: t('load.fields.weightPounds'), value: formatPounds(values.weightPounds ?? null, i18nLocale) },
    {
      key: 'dimensions',
      label: t('load.fields.dimensions'),
      value: `${formatInches(values.lengthInches ?? null, i18nLocale)} × ${formatInches(values.widthInches ?? null, i18nLocale)} × ${formatInches(values.heightInches ?? null, i18nLocale)}`,
    },
    {
      key: 'equipmentType',
      label: t('load.fields.equipmentType'),
      value: equipmentTypes.find((e) => e.id === values.requiredEquipmentTypeId)?.[i18nLocale === 'es' ? 'labelEs' : 'labelEn'] ?? t('common.labels.none'),
    },
    { key: 'customerCharge', label: t('load.financials.customerCharge'), value: formatMoney(values.customerChargeCents ?? null, i18nLocale) },
    { key: 'carrierGrossRate', label: t('load.financials.carrierGrossRate'), value: formatMoney(values.carrierGrossRateCents ?? null, i18nLocale) },
    { key: 'carrierDispatchFee', label: t('load.financials.carrierDispatchFee'), value: formatBps(values.carrierDispatchFeeBps ?? null, i18nLocale) },
    { key: 'dispatcherCommission', label: t('load.financials.dispatcherCommission'), value: formatBps(values.dispatcherCommissionBps ?? null, i18nLocale) },
  ]
  if (mode === 'create') {
    reviewItems.splice(1, 0, {
      key: 'stops',
      label: t('load.stops.title'),
      value: t('load.new.reviewStopsCount', { count: (values as CreateFormValues).stops.length }),
      fullWidth: true,
    })
  }

  return (
    <Form form={form} onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t(`load.new.steps.${currentStepKey}`)}</CardTitle>
          <p className="text-xs text-steel-600">
            {t('load.new.stepProgress', { current: stepIndex + 1, total: steps.length })}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <FormErrorSummary title={t('errors.validationFailed')} />

          {currentStepKey === 'customer' ? (
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <label className="text-sm font-semibold text-carbon" htmlFor="load-customer-search">
                  {t('load.fields.customer')}
                </label>
                <Combobox
                  id="load-customer-search"
                  query={selectedCustomer ? selectedCustomer.label : customerQuery}
                  onQueryChange={(next) => {
                    setCustomerQuery(next)
                    setSelectedCustomer(null)
                    form.setValue('customerId', '')
                    form.setValue('customerContactId', undefined)
                  }}
                  onSelect={(option: ComboboxOption & { contactId?: string }) => {
                    setSelectedCustomer({ id: option.value, label: option.label })
                    form.setValue('customerId', option.value, { shouldValidate: true })
                    form.setValue('customerContactId', option.contactId)
                  }}
                  fetchOptions={async (q) => {
                    const result = await customerAutocompleteAction({ query: q })
                    if (!result.ok) return []
                    return result.data.map((c) => ({
                      value: c.id,
                      label: c.companyName,
                      description: c.primaryContact?.name,
                      contactId: c.primaryContact?.id,
                    }))
                  }}
                  placeholder={t('load.fields.customer')}
                  noResultsLabel={t('customer.autocomplete.noResults')}
                  loadingLabel={t('common.states.loading')}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="customerReference" label={t('load.fields.customerReference')} />
                <TextField name="poNumber" label={t('load.fields.poNumber')} />
              </div>
            </div>
          ) : null}

          {currentStepKey === 'stops' ? (
            <div className="space-y-6">
              {stopsArray.fields.map((field, index) => (
                <div
                  key={field.id}
                  data-testid={`load-stop-${index}`}
                  className="space-y-4 rounded-lg border border-steel-200 p-4"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-carbon">
                      {t(`load.stopTypes.${form.watch(`stops.${index}.stopType`)}`)} #{index + 1}
                    </h4>
                    {stopsArray.fields.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="iconSm"
                        aria-label={t('common.actions.delete')}
                        onClick={() => stopsArray.remove(index)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      name={`stops.${index}.stopType`}
                      label={t('common.labels.type')}
                      options={[
                        { value: 'pickup', label: t('load.stopTypes.pickup') },
                        { value: 'delivery', label: t('load.stopTypes.delivery') },
                      ]}
                    />
                    <TextField name={`stops.${index}.facilityName`} label={t('load.stops.facilityName')} />
                  </div>
                  <AddressField<FormValues>
                    name={`stops.${index}.address`}
                    label={t('load.stops.address')}
                    fetchSuggestions={fetchAddressSuggestions}
                    searchLabel={t('customer.autocomplete.placeholder')}
                    noResultsLabel={t('customer.autocomplete.noResults')}
                    loadingLabel={t('common.states.loading')}
                    fieldLabels={{
                      line1: t('customer.locations.fields.line1'),
                      line2: t('customer.locations.fields.line2'),
                      city: t('common.labels.city'),
                      state: t('common.labels.state'),
                      postalCode: t('common.labels.postalCode'),
                    }}
                    stateOptions={STATE_OPTIONS}
                  />
                  <div className="grid gap-4 sm:grid-cols-3">
                    <TextField name={`stops.${index}.contactName`} label={t('load.stops.contactName')} />
                    <PhoneField name={`stops.${index}.contactPhone`} label={t('load.stops.contactPhone')} />
                    <TextField name={`stops.${index}.contactEmail`} label={t('load.stops.contactEmail')} type="email" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      name={`stops.${index}.appointmentType`}
                      label={t('load.stops.appointmentType')}
                      options={(['exact', 'window', 'fcfs', 'open'] as const).map((v) => ({ value: v, label: t(`load.appointmentTypes.${v}`) }))}
                    />
                    <TextField name={`stops.${index}.confirmationNumber`} label={t('load.stops.confirmationNumber')} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DateTimeField
                      name={`stops.${index}.windowStart`}
                      label={t('load.stops.windowStart')}
                      timeZone={timezone}
                      pickerLabels={buildDateTimePickerLabels(t)}
                    />
                    <DateTimeField
                      name={`stops.${index}.windowEnd`}
                      label={t('load.stops.windowEnd')}
                      timeZone={timezone}
                      pickerLabels={buildDateTimePickerLabels(t)}
                    />
                  </div>
                  <TextareaField name={`stops.${index}.instructions`} label={t('load.stops.instructions')} rows={2} />
                </div>
              ))}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => stopsArray.append({ ...blankStop, stopType: 'pickup' })}>
                  <Plus aria-hidden="true" />
                  {t('load.stopTypes.pickup')}
                </Button>
                <Button type="button" variant="secondary" onClick={() => stopsArray.append({ ...blankStop, stopType: 'delivery' })}>
                  <Plus aria-hidden="true" />
                  {t('load.stopTypes.delivery')}
                </Button>
              </div>
            </div>
          ) : null}

          {currentStepKey === 'freight' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="commodity" label={t('load.fields.commodity')} className="sm:col-span-2" />
              <IntegerField name="weightPounds" label={t('load.fields.weightPounds')} />
              <IntegerField name="pieceCount" label={t('load.fields.pieceCount')} />
              <IntegerField name="lengthInches" label={t('load.fields.lengthInches')} />
              <IntegerField name="widthInches" label={t('load.fields.widthInches')} />
              <IntegerField name="heightInches" label={t('load.fields.heightInches')} />
            </div>
          ) : null}

          {currentStepKey === 'equipment' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="requiredEquipmentTypeId"
                label={t('load.fields.equipmentType')}
                options={equipmentTypes.map((e) => ({ value: e.id, label: i18nLocale === 'es' ? e.labelEs : e.labelEn }))}
              />
              <TextField name="axleConfiguration" label={t('load.fields.axleConfiguration')} />
              <IntegerField name="grossVehicleWeightPounds" label={t('load.fields.grossVehicleWeightPounds')} />
            </div>
          ) : null}

          {currentStepKey === 'financials' ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField name="customerChargeCents" label={t('load.financials.customerCharge')} />
                <MoneyField name="carrierGrossRateCents" label={t('load.financials.carrierGrossRate')} />
                <PercentField name="carrierDispatchFeeBps" label={t('load.financials.carrierDispatchFee')} />
                <PercentField name="dispatcherCommissionBps" label={t('load.financials.dispatcherCommission')} />
                <SelectField
                  name="dispatcherCommissionBasis"
                  label={t('load.financials.dispatcherCommissionBasis')}
                  options={(['dispatch_fee_amount', 'carrier_gross_rate', 'commissionable_base'] as const).map((v) => ({
                    value: v,
                    label: t(`load.financials.commissionBasis.${v}`),
                  }))}
                />
              </div>
              <TextareaField name="specialInstructions" label={t('load.fields.specialInstructions')} rows={3} />
              <TextareaField name="internalNotes" label={t('load.fields.internalNotes')} rows={3} />
            </div>
          ) : null}

          {currentStepKey === 'review' ? (
            <div className="space-y-4">
              <p className="text-sm text-steel-600">{t('load.new.reviewTitle')}</p>
              <DetailList items={reviewItems} />
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-2">
          <div>
            {stepIndex > 0 ? (
              <Button type="button" variant="secondary" onClick={handleBack}>
                {t('load.new.back')}
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={() => router.back()}>
                {t('common.actions.cancel')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {mode === 'create' ? (
              <Button type="submit" variant="secondary" loading={isPending} loadingLabel={t('common.states.saving')}>
                {t('load.new.saveDraft')}
              </Button>
            ) : null}
            {!isLastStep ? (
              // `key` forces React to mount a fresh DOM node for this button
              // rather than reusing the "Create load"/"Save changes" submit
              // button's node with its `type` attribute merely swapped back
              // to "button". Without distinct keys, the step transition
              // *into* the last step reuses the same node and flips its
              // `type` from "button" to "submit" as part of this very
              // button's own click handler (`handleNext`) — the browser
              // evaluates the click's default action against the
              // now-mutated DOM *after* React's synchronous re-render, so it
              // sees a submit button and fires a real native form POST,
              // alongside the intended step change. That stray submission
              // left the form's `isPending` permanently `true` (a second,
              // failed transition raced the intended one), disabling both
              // footer buttons and making the load undeletable-stuck on the
              // review step.
              <Button key="next" type="button" onClick={handleNext}>
                {t('load.new.next')}
              </Button>
            ) : (
              <Button key="submit" type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
                {t(mode === 'create' ? 'load.new.submit' : 'load.edit.submit')}
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>
    </Form>
  )
}
