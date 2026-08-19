'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField, TextareaField, PhoneField, AddressField, type AddressSuggestion } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { stateCodeEnum } from '@/db/schema/_shared'
import type { CustomerLocation } from '@/db/schema'
import {
  addressAutocompleteAction,
  createCustomerLocationAction,
  deleteCustomerLocationAction,
  updateCustomerLocationAction,
} from '@/server/customers/actions'

const STATE_OPTIONS = stateCodeEnum.enumValues.map((code) => ({ value: code, label: code }))

const locationSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(200),
  address: z.object({
    line1: z.string().trim(),
    line2: z.string().trim().optional(),
    city: z.string().trim(),
    state: z.string().trim(),
    postalCode: z.string().trim(),
  }),
  phone: z.string().trim(),
  hours: z.string().trim(),
  instructions: z.string().trim(),
  isPrimary: z.boolean(),
})
type LocationFormValues = z.infer<typeof locationSchema>

function toNullable(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

async function fetchAddressSuggestions(query: string): Promise<AddressSuggestion[]> {
  const result = await addressAutocompleteAction({ query })
  if (!result.ok) return []
  return result.data.map((s) => ({ id: s.id, label: s.label, line1: s.line1, line2: s.line2, city: s.city, state: s.state, postalCode: s.postalCode }))
}

function LocationFormDialog({
  customerId,
  location,
  open,
  onOpenChange,
}: {
  customerId: string
  location: CustomerLocation | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslate()
  const router = useRouter()

  const { form, onSubmit, isPending } = useActionForm<LocationFormValues, { id: string }>({
    schema: locationSchema,
    defaultValues: {
      name: location?.name ?? '',
      address: {
        line1: location?.line1 ?? '',
        line2: location?.line2 ?? '',
        city: location?.city ?? '',
        state: location?.state ?? '',
        postalCode: location?.postalCode ?? '',
      },
      phone: location?.phone ?? '',
      hours: location?.hours ?? '',
      instructions: location?.instructions ?? '',
      isPrimary: location?.isPrimary ?? false,
    },
    action: (values) => {
      // Computed against the original `location` prop rather than RHF's
      // `dirtyFields` — `form` (from this same `useActionForm` call) is not
      // yet in scope inside its own initializer.
      const addressDirty =
        !location ||
        values.address.line1 !== (location.line1 ?? '') ||
        values.address.line2 !== (location.line2 ?? '') ||
        values.address.city !== (location.city ?? '') ||
        values.address.state !== (location.state ?? '') ||
        values.address.postalCode !== (location.postalCode ?? '')
      const payload = {
        name: values.name,
        line1: toNullable(values.address.line1),
        line2: toNullable(values.address.line2),
        city: toNullable(values.address.city),
        state: toNullable(values.address.state),
        postalCode: toNullable(values.address.postalCode),
        phone: toNullable(values.phone),
        hours: toNullable(values.hours),
        instructions: toNullable(values.instructions),
        isPrimary: values.isPrimary,
      }
      return location
        ? updateCustomerLocationAction({ locationId: location.id, addressChanged: addressDirty, ...payload })
        : createCustomerLocationAction({ customerId, ...payload })
    },
    onSuccess: () => {
      onOpenChange(false)
      router.refresh()
    },
    successMessageKey: location ? 'common.actions.save' : 'common.actions.create',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t(location ? 'customer.locations.edit' : 'customer.locations.add')}</DialogTitle>
          </DialogHeader>
          <FormErrorSummary title={t('errors.validationFailed')} />
          <TextField name="name" label={t('customer.locations.fields.name')} required />
          <AddressField<LocationFormValues>
            name="address"
            label={t('customer.locations.fields.address')}
            required
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
          <div className="grid gap-4 sm:grid-cols-2">
            <PhoneField name="phone" label={t('customer.locations.fields.phone')} />
            <TextField name="hours" label={t('customer.locations.fields.hours')} />
          </div>
          <TextareaField name="instructions" label={t('customer.locations.fields.instructions')} rows={3} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
              {t('common.actions.save')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function LocationsPanel({
  customerId,
  locations,
  canManage,
}: {
  customerId: string
  locations: CustomerLocation[]
  canManage: boolean
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [dialogState, setDialogState] = React.useState<{ open: boolean; location: CustomerLocation | null }>({
    open: false,
    location: null,
  })
  const [deleteTarget, setDeleteTarget] = React.useState<CustomerLocation | null>(null)
  const [isPending, setPending] = React.useState(false)

  async function handleSetPrimary(location: CustomerLocation) {
    setPending(true)
    const result = await updateCustomerLocationAction({ locationId: location.id, isPrimary: true })
    setPending(false)
    if (result.ok) {
      router.refresh()
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setPending(true)
    const result = await deleteCustomerLocationAction({ locationId: deleteTarget.id })
    setPending(false)
    setDeleteTarget(null)
    if (result.ok) {
      router.refresh()
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-carbon">{t('customer.locations.title')}</h3>
        {canManage ? (
          <Button size="sm" onClick={() => setDialogState({ open: true, location: null })}>
            <Plus aria-hidden="true" />
            {t('customer.locations.add')}
          </Button>
        ) : null}
      </div>

      {locations.length === 0 ? (
        <EmptyState title={t('customer.locations.empty')} />
      ) : (
        <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
          {locations.map((location) => (
            <li key={location.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-carbon">{location.name}</span>
                  {location.isPrimary ? <Badge tone="navy">{t('customer.locations.primary')}</Badge> : null}
                </div>
                <p className="text-sm text-steel-600">
                  {[location.line1, location.city, location.state, location.postalCode].filter(Boolean).join(', ') || '—'}
                </p>
              </div>
              {canManage ? (
                <div className="flex items-center gap-1">
                  {!location.isPrimary ? (
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={t('customer.locations.setPrimary')}
                      disabled={isPending}
                      onClick={() => handleSetPrimary(location)}
                    >
                      <Star aria-hidden="true" />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={t('common.actions.edit')}
                    onClick={() => setDialogState({ open: true, location })}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={t('customer.locations.delete')}
                    onClick={() => setDeleteTarget(location)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <LocationFormDialog
          customerId={customerId}
          location={dialogState.location}
          open={dialogState.open}
          onOpenChange={(open) => setDialogState((prev) => ({ ...prev, open }))}
        />
      ) : null}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('customer.locations.delete')}</AlertDialogTitle>
            <AlertDialogDescription>{t('customer.locations.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={handleDelete}>
              {t('common.actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
