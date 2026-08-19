'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import {
  TextField,
  TextareaField,
  PhoneField,
  SelectField,
  DateTimeField,
  AddressField,
  type AddressSuggestion,
} from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { stateCodeEnum } from '@/db/schema/_shared'
import type { LoadStop } from '@/db/schema'
import { buildDateTimePickerLabels } from '../../_components/datetime-picker-labels'
import {
  addLoadStopAction,
  recordStopArrivalAction,
  recordStopDepartureAction,
  removeLoadStopAction,
  reorderLoadStopsAction,
  stopAddressAutocompleteAction,
} from '@/server/loads/actions'

const STATE_OPTIONS = stateCodeEnum.enumValues.map((code) => ({ value: code, label: code }))

async function fetchAddressSuggestions(query: string): Promise<AddressSuggestion[]> {
  const result = await stopAddressAutocompleteAction({ query })
  if (!result.ok) return []
  return result.data.map((s) => ({ id: s.id, label: s.label, line1: s.line1, line2: s.line2, city: s.city, state: s.state, postalCode: s.postalCode }))
}

const stopSchema = z.object({
  stopType: z.enum(['pickup', 'delivery']),
  facilityName: z.string().trim(),
  address: z.object({
    line1: z.string().trim(),
    line2: z.string().trim().optional(),
    city: z.string().trim(),
    state: z.string().trim(),
    postalCode: z.string().trim(),
  }),
  contactName: z.string().trim(),
  contactPhone: z.string().trim(),
  contactEmail: z.string().trim(),
  confirmationNumber: z.string().trim(),
  instructions: z.string().trim(),
  appointmentType: z.enum(['exact', 'window', 'fcfs', 'open']),
  // `DateTimeField` binds to a UTC ISO string (or null), never a `Date` —
  // the server's `z.coerce.date()` accepts it as-is.
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
})
type StopFormValues = z.infer<typeof stopSchema>

function toNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function AddStopDialog({ loadId, open, onOpenChange }: { loadId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslate()
  const router = useRouter()
  const { timezone } = useI18n()

  const { form, onSubmit, isPending } = useActionForm<StopFormValues, { id: string }>({
    schema: stopSchema,
    defaultValues: {
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
    },
    action: (values) =>
      addLoadStopAction({
        loadId,
        stopType: values.stopType,
        facilityName: toNullable(values.facilityName),
        line1: toNullable(values.address.line1),
        line2: toNullable(values.address.line2 ?? ''),
        city: toNullable(values.address.city),
        state: toNullable(values.address.state),
        postalCode: toNullable(values.address.postalCode),
        contactName: toNullable(values.contactName),
        contactPhone: toNullable(values.contactPhone),
        contactEmail: toNullable(values.contactEmail),
        confirmationNumber: toNullable(values.confirmationNumber),
        instructions: toNullable(values.instructions),
        appointmentType: values.appointmentType,
        windowStart: values.windowStart,
        windowEnd: values.windowEnd,
      }),
    onSuccess: () => {
      onOpenChange(false)
      router.refresh()
    },
    successMessageKey: 'common.actions.create',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('load.stops.add')}</DialogTitle>
          </DialogHeader>
          <FormErrorSummary title={t('errors.validationFailed')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="stopType"
              label={t('common.labels.type')}
              options={[
                { value: 'pickup', label: t('load.stopTypes.pickup') },
                { value: 'delivery', label: t('load.stopTypes.delivery') },
              ]}
            />
            <TextField name="facilityName" label={t('load.stops.facilityName')} />
          </div>
          <AddressField<StopFormValues>
            name="address"
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
            <TextField name="contactName" label={t('load.stops.contactName')} />
            <PhoneField name="contactPhone" label={t('load.stops.contactPhone')} />
            <TextField name="contactEmail" label={t('load.stops.contactEmail')} type="email" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="appointmentType"
              label={t('load.stops.appointmentType')}
              options={(['exact', 'window', 'fcfs', 'open'] as const).map((v) => ({ value: v, label: t(`load.appointmentTypes.${v}`) }))}
            />
            <TextField name="confirmationNumber" label={t('load.stops.confirmationNumber')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateTimeField name="windowStart" label={t('load.stops.windowStart')} timeZone={timezone} pickerLabels={buildDateTimePickerLabels(t)} />
            <DateTimeField name="windowEnd" label={t('load.stops.windowEnd')} timeZone={timezone} pickerLabels={buildDateTimePickerLabels(t)} />
          </div>
          <TextareaField name="instructions" label={t('load.stops.instructions')} rows={3} />
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

export function StopsPanel({ loadId, stops, canManage }: { loadId: string; stops: LoadStop[]; canManage: boolean }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const { locale, timezone } = useI18n()
  const [addOpen, setAddOpen] = React.useState(false)
  const [removeTarget, setRemoveTarget] = React.useState<LoadStop | null>(null)
  const [isPending, setPending] = React.useState(false)

  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence)

  async function move(stop: LoadStop, direction: -1 | 1) {
    const index = ordered.findIndex((s) => s.id === stop.id)
    const swapWith = ordered[index + direction]
    if (!swapWith) return
    const next = [...ordered]
    ;[next[index], next[index + direction]] = [next[index + direction]!, next[index]!]
    setPending(true)
    const result = await reorderLoadStopsAction({ loadId, stopIds: next.map((s) => s.id) })
    setPending(false)
    if (result.ok) router.refresh()
    else toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
  }

  async function handleRemove() {
    if (!removeTarget) return
    setPending(true)
    const result = await removeLoadStopAction({ loadId, stopId: removeTarget.id })
    setPending(false)
    setRemoveTarget(null)
    if (result.ok) router.refresh()
    else toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
  }

  async function recordArrival(stop: LoadStop) {
    setPending(true)
    const result = await recordStopArrivalAction({ loadId, stopId: stop.id, arrivedAt: new Date() })
    setPending(false)
    if (result.ok) router.refresh()
    else toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
  }

  async function recordDeparture(stop: LoadStop) {
    setPending(true)
    const result = await recordStopDepartureAction({ loadId, stopId: stop.id, departedAt: new Date() })
    setPending(false)
    if (result.ok) router.refresh()
    else toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-carbon">{t('load.stops.title')}</h3>
        {canManage ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden="true" />
            {t('load.stops.add')}
          </Button>
        ) : null}
      </div>

      {ordered.length === 0 ? (
        <EmptyState title={t('load.stops.empty')} />
      ) : (
        <ol className="space-y-3">
          {ordered.map((stop, index) => (
            <li key={stop.id} className="rounded-lg border border-steel-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone="navy">{t('load.stops.sequence', { sequence: stop.sequence })}</Badge>
                    <span className="font-semibold text-carbon">{t(`load.stopTypes.${stop.stopType}`)}</span>
                  </div>
                  <p className="mt-1 text-sm text-carbon">
                    {stop.facilityName ? `${stop.facilityName} — ` : ''}
                    {[stop.line1, stop.city, stop.state, stop.postalCode].filter(Boolean).join(', ') || t('common.labels.none')}
                  </p>
                  <p className="text-xs text-steel-600">
                    {t(`load.appointmentTypes.${stop.appointmentType}`)}
                    {stop.windowStart ? ` · ${formatDateTime(stop.windowStart, locale, stop.timezone || timezone)}` : ''}
                    {stop.windowEnd ? ` – ${formatDateTime(stop.windowEnd, locale, stop.timezone || timezone)}` : ''}
                  </p>
                  {stop.actualArrivalAt ? (
                    <p className="text-xs text-steel-600">
                      {t('load.stops.actualArrivalAt')}: {formatDateTime(stop.actualArrivalAt, locale, stop.timezone || timezone)}
                    </p>
                  ) : null}
                  {stop.actualDepartureAt ? (
                    <p className="text-xs text-steel-600">
                      {t('load.stops.actualDepartureAt')}: {formatDateTime(stop.actualDepartureAt, locale, stop.timezone || timezone)}
                      {' · '}
                      {stop.detentionMinutes != null
                        ? t('load.stops.detentionMinutesValue', { minutes: stop.detentionMinutes })
                        : t('load.stops.noDetention')}
                    </p>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="iconSm" aria-label={t('common.actions.previous')} disabled={index === 0 || isPending} onClick={() => move(stop, -1)}>
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={t('common.actions.next')}
                      disabled={index === ordered.length - 1 || isPending}
                      onClick={() => move(stop, 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="iconSm" aria-label={t('load.stops.remove')} onClick={() => setRemoveTarget(stop)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </div>
              {canManage ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {!stop.actualArrivalAt ? (
                    <Button variant="secondary" size="sm" disabled={isPending} onClick={() => recordArrival(stop)}>
                      {t('load.stops.recordArrival')}
                    </Button>
                  ) : !stop.actualDepartureAt ? (
                    <Button variant="secondary" size="sm" disabled={isPending} onClick={() => recordDeparture(stop)}>
                      {t('load.stops.recordDeparture')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {canManage ? <AddStopDialog loadId={loadId} open={addOpen} onOpenChange={setAddOpen} /> : null}

      <AlertDialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('load.stops.remove')}</AlertDialogTitle>
            <AlertDialogDescription>{t('load.stops.removeConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={handleRemove}>
              {t('common.actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
