'use client'

import * as React from 'react'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useActionForm, type ActionResultLike } from '@/components/forms/use-action-form'
import { Controller } from 'react-hook-form'
import { Form, FormErrorSummary, FormField, useFormContext } from '@/components/forms/form'
import {
  TextField,
  TextareaField,
  PhoneField,
  MoneyField,
  MaskedField,
  CheckboxField,
  SelectField,
  AddressField,
  type AddressSuggestion,
} from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input, Textarea } from '@/components/ui/input'
import { Alert } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { stateCodeEnum } from '@/db/schema/_shared'
import type { Customer } from '@/db/schema'
import type { DuplicateMatch } from '@/server/customers/duplicates'
import { addressAutocompleteAction, createCustomerAction, updateCustomerAction } from '@/server/customers/actions'

const STATE_OPTIONS = stateCodeEnum.enumValues.map((code) => ({ value: code, label: code }))

const addressGroupSchema = z.object({
  line1: z.string().trim(),
  line2: z.string().trim().optional(),
  city: z.string().trim(),
  state: z.string().trim(),
  postalCode: z.string().trim(),
})

const schema = z.object({
  companyName: z.string().trim().min(1, 'validation.required').max(200),
  dotNumber: z.string().trim(),
  mcNumber: z.string().trim(),
  website: z.string().trim(),
  phone: z.string().trim(),
  email: z.string().trim(),
  physical: addressGroupSchema,
  billingSameAsPhysical: z.boolean(),
  billing: addressGroupSchema,
  taxId: z.string().trim().optional(),
  creditLimitCents: z.number().nullable(),
  creditApproved: z.boolean(),
  creditNotes: z.string().trim(),
  paymentTermsDays: z.number().int().min(0).max(365),
  usesFactoring: z.boolean(),
  factoringCompanyName: z.string().trim(),
  status: z.enum(['active', 'on_hold', 'inactive']),
  notes: z.string().trim(),
})
type CustomerFormValues = z.infer<typeof schema>

function toNullable(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

async function fetchAddressSuggestions(query: string): Promise<AddressSuggestion[]> {
  const result = await addressAutocompleteAction({ query })
  if (!result.ok) return []
  return result.data.map((s) => ({ id: s.id, label: s.label, line1: s.line1, line2: s.line2, city: s.city, state: s.state, postalCode: s.postalCode }))
}

interface NormalizedOutput {
  id: string
  conflict: DuplicateMatch[] | null
}

export interface CustomerFormProps {
  locale: string
  mode: 'create' | 'edit'
  customer?: Customer
}

export function CustomerForm({ locale, mode, customer }: CustomerFormProps) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()

  const pendingPayloadRef = React.useRef<Record<string, unknown> | null>(null)
  const [duplicateState, setDuplicateState] = React.useState<{ open: boolean; matches: DuplicateMatch[] }>({
    open: false,
    matches: [],
  })
  const [overrideReason, setOverrideReason] = React.useState('')
  const [overridePending, setOverridePending] = React.useState(false)

  const { form, onSubmit, isPending } = useActionForm<CustomerFormValues, NormalizedOutput>({
    schema,
    defaultValues: {
      companyName: customer?.companyName ?? '',
      dotNumber: customer?.dotNumber ?? '',
      mcNumber: customer?.mcNumber ?? '',
      website: customer?.website ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
      physical: {
        line1: customer?.physicalLine1 ?? '',
        line2: customer?.physicalLine2 ?? '',
        city: customer?.physicalCity ?? '',
        state: customer?.physicalState ?? '',
        postalCode: customer?.physicalPostalCode ?? '',
      },
      billingSameAsPhysical: customer?.billingSameAsPhysical ?? true,
      billing: {
        line1: customer?.billingLine1 ?? '',
        line2: customer?.billingLine2 ?? '',
        city: customer?.billingCity ?? '',
        state: customer?.billingState ?? '',
        postalCode: customer?.billingPostalCode ?? '',
      },
      taxId: undefined,
      creditLimitCents: customer?.creditLimitCents ?? null,
      creditApproved: customer?.creditApproved ?? false,
      creditNotes: customer?.creditNotes ?? '',
      paymentTermsDays: customer?.paymentTermsDays ?? 30,
      usesFactoring: customer?.usesFactoring ?? false,
      factoringCompanyName: customer?.factoringCompanyName ?? '',
      // `customers.status` is a plain varchar (not a DB enum) constrained to
      // these three values by application convention — see `customer.ts`.
      status: (customer?.status as 'active' | 'on_hold' | 'inactive' | undefined) ?? 'active',
      notes: customer?.notes ?? '',
    },
    action: async (values): Promise<ActionResultLike<NormalizedOutput>> => {
      const payload = {
        companyName: values.companyName,
        dotNumber: toNullable(values.dotNumber),
        mcNumber: toNullable(values.mcNumber),
        website: toNullable(values.website),
        phone: toNullable(values.phone),
        email: toNullable(values.email),
        physicalLine1: toNullable(values.physical.line1),
        physicalLine2: toNullable(values.physical.line2),
        physicalCity: toNullable(values.physical.city),
        physicalState: toNullable(values.physical.state),
        physicalPostalCode: toNullable(values.physical.postalCode),
        billingSameAsPhysical: values.billingSameAsPhysical,
        billingLine1: values.billingSameAsPhysical ? null : toNullable(values.billing.line1),
        billingLine2: values.billingSameAsPhysical ? null : toNullable(values.billing.line2),
        billingCity: values.billingSameAsPhysical ? null : toNullable(values.billing.city),
        billingState: values.billingSameAsPhysical ? null : toNullable(values.billing.state),
        billingPostalCode: values.billingSameAsPhysical ? null : toNullable(values.billing.postalCode),
        taxId: values.taxId === undefined ? undefined : toNullable(values.taxId),
        creditLimitCents: values.creditLimitCents,
        creditApproved: values.creditApproved,
        creditNotes: toNullable(values.creditNotes),
        paymentTermsDays: values.paymentTermsDays,
        usesFactoring: values.usesFactoring,
        factoringCompanyName: toNullable(values.factoringCompanyName),
        notes: toNullable(values.notes),
      }

      if (mode === 'edit' && customer) {
        const result = await updateCustomerAction({ customerId: customer.id, status: values.status, ...payload })
        if (!result.ok) return result
        return { ok: true, data: { id: result.data.id, conflict: null } }
      }

      pendingPayloadRef.current = payload
      const result = await createCustomerAction(payload)
      if (!result.ok) return result
      if (result.data.status === 'conflict') {
        return { ok: true, data: { id: '', conflict: result.data.matches } }
      }
      return { ok: true, data: { id: result.data.customer.id, conflict: null } }
    },
    onSuccess: (data) => {
      if (data.conflict) {
        setDuplicateState({ open: true, matches: data.conflict })
        return
      }
      toast({ tone: 'success', title: t(mode === 'create' ? 'common.actions.create' : 'common.actions.save') })
      router.push(`/${locale}/app/customers/${data.id}`)
      router.refresh()
    },
  })

  async function handleOverrideConfirm() {
    if (!pendingPayloadRef.current || overrideReason.trim().length === 0) return
    setOverridePending(true)
    const result = await createCustomerAction({
      ...pendingPayloadRef.current,
      overrideDuplicate: true,
      duplicateOverrideReason: overrideReason.trim(),
    } as Parameters<typeof createCustomerAction>[0])
    setOverridePending(false)
    if (!result.ok) {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      return
    }
    if (result.data.status === 'conflict') {
      setDuplicateState({ open: true, matches: result.data.matches })
      return
    }
    setDuplicateState({ open: false, matches: [] })
    toast({ tone: 'success', title: t('common.actions.create') })
    router.push(`/${locale}/app/customers/${result.data.customer.id}`)
    router.refresh()
  }

  return (
    <>
      <Form form={form} onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t(mode === 'create' ? 'customer.new.steps.company' : 'customer.edit.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormErrorSummary title={t('errors.validationFailed')} />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="companyName" label={t('customer.fields.companyName')} required className="sm:col-span-2" />
              <TextField name="dotNumber" label={t('customer.fields.dotNumber')} />
              <TextField name="mcNumber" label={t('customer.fields.mcNumber')} />
              <TextField name="website" label={t('customer.fields.website')} />
              {mode === 'edit' ? (
                <SelectField
                  name="status"
                  label={t('customer.fields.status')}
                  options={(['active', 'on_hold', 'inactive'] as const).map((s) => ({ value: s, label: t(`customer.status.${s}`) }))}
                />
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <PhoneField name="phone" label={t('customer.fields.phone')} />
              <TextField name="email" label={t('customer.fields.email')} type="email" />
            </div>

            <div className="space-y-4 border-t border-steel-200 pt-4">
              <h3 className="text-sm font-bold text-carbon">{t('customer.new.steps.address')}</h3>
              <AddressField<CustomerFormValues>
                name="physical"
                label={t('customer.fields.physicalAddress')}
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
              <CheckboxField name="billingSameAsPhysical" label={t('customer.fields.billingSameAsPhysical')} />
              <BillingAddressFields />
            </div>

            <div className="space-y-4 border-t border-steel-200 pt-4">
              <h3 className="text-sm font-bold text-carbon">{t('customer.new.steps.billing')}</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <MaskedField
                  name="taxId"
                  label={t('customer.fields.taxId')}
                  maskedDisplay={customer?.taxIdLast4 ? t('common.labels.lastFour', { last4: customer.taxIdLast4 }) : undefined}
                  replaceLabel={t('customer.fields.taxIdReplace')}
                  cancelLabel={t('customer.fields.taxIdCancel')}
                />
                <MoneyField name="creditLimitCents" label={t('customer.fields.creditLimit')} />
                <PaymentTermsField />
              </div>
              <CheckboxField name="creditApproved" label={t('customer.fields.creditApproved')} />
              <TextareaField name="creditNotes" label={t('customer.fields.creditNotes')} rows={3} />
              <CheckboxField name="usesFactoring" label={t('customer.fields.usesFactoring')} />
              <FactoringNameField />
            </div>

            <TextareaField name="notes" label={t('customer.fields.notes')} rows={3} />
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
              {t(mode === 'create' ? 'customer.new.submit' : 'customer.edit.submit')}
            </Button>
          </CardFooter>
        </Card>
      </Form>

      <Dialog open={duplicateState.open} onOpenChange={(open) => setDuplicateState((prev) => ({ ...prev, open }))}>
        <DialogContent closeLabel={t('common.actions.close')}>
          <DialogHeader>
            <DialogTitle>{t('customer.duplicates.title')}</DialogTitle>
            <DialogDescription>{t('customer.duplicates.description', { count: duplicateState.matches.length })}</DialogDescription>
          </DialogHeader>

          <Alert tone="warning">{t('customer.duplicates.reviewPrompt')}</Alert>

          <ul className="space-y-2">
            {duplicateState.matches.map((match) => (
              <li key={`${match.customerId}-${match.matchedOn}`} className="rounded-lg border border-steel-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-carbon">{match.label}</span>
                  <Badge tone={match.confidence === 'exact' ? 'danger' : 'warning'}>
                    {t(`customer.duplicates.confidence.${match.confidence}`)}
                  </Badge>
                </div>
                <p className="text-sm text-steel-600">{t(`customer.duplicates.matchedOn.${match.matchedOn}`)}</p>
              </li>
            ))}
          </ul>

          <div className="grid gap-1.5">
            <Label htmlFor="duplicate-override-reason" required>
              {t('customer.duplicates.reasonLabel')}
            </Label>
            <Textarea
              id="duplicate-override-reason"
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              placeholder={t('customer.duplicates.reasonPlaceholder')}
              rows={3}
            />
            {overrideReason.trim().length === 0 ? (
              <p className="text-xs text-steel-600">{t('customer.duplicates.reasonRequired')}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDuplicateState({ open: false, matches: [] })}>
              {t('customer.duplicates.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={overrideReason.trim().length === 0}
              loading={overridePending}
              onClick={handleOverrideConfirm}
            >
              {t('customer.duplicates.proceed')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function BillingAddressFields() {
  const t = useTranslate()
  const { watch } = useFormContext<CustomerFormValues>()
  const same = watch('billingSameAsPhysical')
  if (same) return null
  return (
    <AddressField<CustomerFormValues>
      name="billing"
      label={t('customer.fields.billingAddress')}
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
  )
}

/** `paymentTermsDays` is a plain integer, not one of `TextField`'s string-valued types. */
function PaymentTermsField() {
  const t = useTranslate()
  const { control } = useFormContext<CustomerFormValues>()
  return (
    <FormField<CustomerFormValues>
      name="paymentTermsDays"
      label={t('customer.fields.paymentTermsDays')}
      render={(bind) => (
        <Controller
          control={control}
          name="paymentTermsDays"
          render={({ field }) => (
            <Input
              {...bind}
              type="number"
              min={0}
              max={365}
              value={field.value ?? 0}
              onChange={(event) => field.onChange(event.target.value === '' ? 0 : Number(event.target.value))}
              onBlur={field.onBlur}
            />
          )}
        />
      )}
    />
  )
}

function FactoringNameField() {
  const t = useTranslate()
  const { watch } = useFormContext<CustomerFormValues>()
  const uses = watch('usesFactoring')
  if (!uses) return null
  return <TextField name="factoringCompanyName" label={t('customer.fields.factoringCompanyName')} />
}
