'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { DateTimeField, MoneyField, SelectField, TextField, TextareaField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { stateCodeEnum } from '@/db/schema/_shared'
import type { Escort } from '@/db/schema'
import { createEscortAction, updateEscortAction } from '@/server/permits/actions'
import { buildDateTimePickerLabels } from './date-picker-labels'

const STATE_OPTIONS = stateCodeEnum.enumValues.map((code) => ({ value: code, label: code }))
const ESCORT_TYPE_VALUES = ['pilot_car', 'police', 'height_pole', 'route_survey'] as const
const STATUS_VALUES = ['pending', 'confirmed', 'completed', 'cancelled', 'not_required'] as const

function readFileAsBase64(file: File): Promise<{ originalFilename: string; fileBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve({ originalFilename: file.name, fileBase64: result.slice(result.indexOf(',') + 1) })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const escortFormSchema = z.object({
  escortType: z.enum(ESCORT_TYPE_VALUES),
  stateCode: z.string(),
  providerName: z.string().trim().max(200),
  agencyName: z.string().trim().max(200),
  contactName: z.string().trim().max(200),
  contactPhone: z.string().trim().max(32),
  contactEmail: z.string().trim().max(255),
  scheduledFor: z.string().nullable(),
  costCents: z.number().int().nonnegative().nullable(),
  status: z.enum(STATUS_VALUES),
  notes: z.string().trim().max(2000),
})
type EscortFormValues = z.infer<typeof escortFormSchema>

export function EscortFormDialog({
  loadId,
  escort,
  open,
  onOpenChange,
}: {
  loadId: string
  escort?: Escort | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslate()
  const router = useRouter()
  const { timezone } = useI18n()
  const [file, setFile] = React.useState<File | null>(null)
  const isEdit = Boolean(escort)

  const { form, onSubmit, isPending } = useActionForm<EscortFormValues, { id: string }>({
    schema: escortFormSchema,
    defaultValues: {
      escortType: (escort?.escortType ?? 'pilot_car') as EscortFormValues['escortType'],
      stateCode: escort?.stateCode ?? 'none',
      providerName: escort?.providerName ?? '',
      agencyName: escort?.agencyName ?? '',
      contactName: escort?.contactName ?? '',
      contactPhone: escort?.contactPhone ?? '',
      contactEmail: escort?.contactEmail ?? '',
      scheduledFor: escort?.scheduledFor?.toISOString() ?? null,
      costCents: escort?.costCents ?? 0,
      status: (escort?.status ?? 'pending') as EscortFormValues['status'],
      notes: escort?.notes ?? '',
    },
    action: async (values) => {
      const document = file ? await readFileAsBase64(file) : null
      const shared = {
        providerName: values.providerName.trim() || null,
        agencyName: values.agencyName.trim() || null,
        contactName: values.contactName.trim() || null,
        contactPhone: values.contactPhone.trim() || null,
        contactEmail: values.contactEmail.trim() || null,
        scheduledFor: values.scheduledFor ? new Date(values.scheduledFor) : null,
        costCents: values.costCents ?? 0,
        status: values.status,
        notes: values.notes.trim() || null,
        document,
      }
      return escort
        ? updateEscortAction({ loadId, escortId: escort.id, ...shared })
        : createEscortAction({
            loadId,
            escortType: values.escortType,
            stateCode: values.stateCode === 'none' ? null : values.stateCode,
            ...shared,
          })
    },
    onSuccess: () => {
      onOpenChange(false)
      setFile(null)
      router.refresh()
    },
    successMessageKey: isEdit ? 'oversize.escorts.updated' : 'oversize.escorts.created',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t(isEdit ? 'oversize.escorts.editButton' : 'oversize.escorts.addButton')}</DialogTitle>
          </DialogHeader>
          <FormErrorSummary title={t('errors.validationFailed')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="escortType"
              label={t('common.labels.type')}
              options={ESCORT_TYPE_VALUES.map((value) => ({ value, label: t(`oversize.escorts.type.${value}`) }))}
              disabled={isEdit}
              required
            />
            <SelectField
              name="stateCode"
              label={t('oversize.permits.stateLabel')}
              options={[{ value: 'none', label: '—' }, ...STATE_OPTIONS]}
              disabled={isEdit}
            />
            <SelectField
              name="status"
              label={t('common.labels.status')}
              options={STATUS_VALUES.map((value) => ({ value, label: t(`oversize.escorts.status.${value}`) }))}
            />
            <TextField name="providerName" label={t('oversize.escorts.providerNameLabel')} />
            <TextField name="agencyName" label={t('oversize.escorts.agencyNameLabel')} />
            <TextField name="contactName" label={t('oversize.escorts.contactNameLabel')} />
            <TextField name="contactPhone" label={t('oversize.escorts.contactPhoneLabel')} />
            <TextField name="contactEmail" label={t('oversize.escorts.contactEmailLabel')} type="email" />
            <DateTimeField
              name="scheduledFor"
              label={t('oversize.escorts.scheduledForLabel')}
              timeZone={timezone}
              pickerLabels={buildDateTimePickerLabels(t)}
            />
            <MoneyField name="costCents" label={t('oversize.escorts.costLabel')} />
          </div>
          <TextareaField name="notes" label={t('oversize.escorts.notesLabel')} rows={2} />
          <div className="grid gap-1.5">
            <Label htmlFor="escort-document">{t('oversize.escorts.documentLabel')}</Label>
            <input
              id="escort-document"
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </div>
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
