'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { DateField, MoneyField, SelectField, TextField, TextareaField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { stateCodeEnum } from '@/db/schema/_shared'
import type { Permit } from '@/db/schema'
import { createPermitAction, updatePermitAction } from '@/server/permits/actions'
import { buildDatePickerLabels } from './date-picker-labels'

const STATE_OPTIONS = stateCodeEnum.enumValues.map((code) => ({ value: code, label: code }))
const STATUS_VALUES = ['pending', 'requested', 'issued', 'expired', 'rejected', 'not_required'] as const

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

const permitFormSchema = z.object({
  stateCode: z.string().min(2),
  permitType: z.string().trim().max(60),
  permitNumber: z.string().trim().max(80),
  issuedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  costCents: z.number().int().nonnegative().nullable(),
  status: z.enum(STATUS_VALUES),
  notes: z.string().trim().max(2000),
})
type PermitFormValues = z.infer<typeof permitFormSchema>

export function PermitFormDialog({
  loadId,
  permit,
  open,
  onOpenChange,
}: {
  loadId: string
  permit?: Permit | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslate()
  const router = useRouter()
  const { timezone } = useI18n()
  const [file, setFile] = React.useState<File | null>(null)
  const [routeSurveyFile, setRouteSurveyFile] = React.useState<File | null>(null)
  const isEdit = Boolean(permit)

  const { form, onSubmit, isPending } = useActionForm<PermitFormValues, { id: string }>({
    schema: permitFormSchema,
    defaultValues: {
      stateCode: permit?.stateCode ?? '',
      permitType: permit?.permitType ?? '',
      permitNumber: permit?.permitNumber ?? '',
      issuedAt: permit?.issuedAt?.toISOString() ?? null,
      expiresAt: permit?.expiresAt?.toISOString() ?? null,
      costCents: permit?.costCents ?? 0,
      status: (permit?.status ?? 'pending') as PermitFormValues['status'],
      notes: permit?.notes ?? '',
    },
    action: async (values) => {
      const document = file ? await readFileAsBase64(file) : null
      const routeSurveyDocument = routeSurveyFile ? await readFileAsBase64(routeSurveyFile) : null
      const shared = {
        permitType: values.permitType.trim() || null,
        permitNumber: values.permitNumber.trim() || null,
        issuedAt: values.issuedAt ? new Date(values.issuedAt) : null,
        expiresAt: values.expiresAt ? new Date(values.expiresAt) : null,
        costCents: values.costCents ?? 0,
        status: values.status,
        notes: values.notes.trim() || null,
        document,
        routeSurveyDocument,
      }
      return permit
        ? updatePermitAction({ loadId, permitId: permit.id, ...shared })
        : createPermitAction({ loadId, stateCode: values.stateCode, ...shared })
    },
    onSuccess: () => {
      onOpenChange(false)
      setFile(null)
      setRouteSurveyFile(null)
      router.refresh()
    },
    successMessageKey: isEdit ? 'oversize.permits.updated' : 'oversize.permits.created',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t(isEdit ? 'oversize.permits.editButton' : 'oversize.permits.addButton')}</DialogTitle>
          </DialogHeader>
          <FormErrorSummary title={t('errors.validationFailed')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="stateCode"
              label={t('oversize.permits.stateLabel')}
              options={STATE_OPTIONS}
              disabled={isEdit}
              required
            />
            <SelectField
              name="status"
              label={t('common.labels.status')}
              options={STATUS_VALUES.map((value) => ({ value, label: t(`oversize.permits.status.${value}`) }))}
            />
            <TextField name="permitType" label={t('oversize.permits.permitTypeLabel')} />
            <TextField name="permitNumber" label={t('oversize.permits.permitNumberLabel')} />
            <DateField
              name="issuedAt"
              label={t('oversize.permits.issuedAtLabel')}
              timeZone={timezone}
              pickerLabels={buildDatePickerLabels(t)}
            />
            <DateField
              name="expiresAt"
              label={t('oversize.permits.expiresAtLabel')}
              timeZone={timezone}
              pickerLabels={buildDatePickerLabels(t)}
            />
            <MoneyField name="costCents" label={t('oversize.permits.costLabel')} />
          </div>
          <TextareaField name="notes" label={t('oversize.permits.notesLabel')} rows={2} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="permit-document">{t('oversize.permits.documentLabel')}</Label>
              <input
                id="permit-document"
                type="file"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="text-sm"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="permit-route-survey">{t('oversize.permits.routeSurveyDocumentLabel')}</Label>
              <input
                id="permit-route-survey"
                type="file"
                onChange={(event) => setRouteSurveyFile(event.target.files?.[0] ?? null)}
                className="text-sm"
              />
            </div>
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
