'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/forms/form'
import { SelectField, SwitchField, TextField, TextareaField } from '@/components/forms/fields'
import { useActionForm } from '@/components/forms/use-action-form'
import { useTranslate } from '@/components/providers/i18n-provider'
import { stateCodeEnum } from '@/db/schema/_shared'
import { createFactoringCompanyAction, updateFactoringCompanyAction } from '@/server/factoring/actions'
import type { FactoringCompany } from '@/db/schema'

const STATE_OPTIONS = stateCodeEnum.enumValues.map((code) => ({ value: code, label: code }))

const schema = z.object({
  name: z.string().trim().min(1, { message: 'validation.required' }),
  contactName: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  phone: z.string().trim().optional(),
  addressLine1: z.string().trim().optional(),
  addressCity: z.string().trim().optional(),
  addressState: z.string().optional(),
  addressPostalCode: z.string().trim().optional(),
  fundingInstructions: z.string().trim().optional(),
  active: z.boolean().optional(),
})

type FormValues = z.infer<typeof schema>

export function CompanyFormDialog({ company, trigger }: { company?: FactoringCompany; trigger: React.ReactNode }) {
  const t = useTranslate()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  const { form, onSubmit, isPending } = useActionForm<FormValues, unknown>({
    schema,
    defaultValues: {
      name: company?.name ?? '',
      contactName: company?.contactName ?? '',
      email: company?.email ?? '',
      phone: company?.phone ?? '',
      addressLine1: company?.addressLine1 ?? '',
      addressCity: company?.addressCity ?? '',
      addressState: company?.addressState ?? undefined,
      addressPostalCode: company?.addressPostalCode ?? '',
      fundingInstructions: company?.fundingInstructions ?? '',
      active: company?.active ?? true,
    },
    successMessageKey: company
      ? 'finance.factoring.companies.updateSuccess'
      : 'finance.factoring.companies.createSuccess',
    onSuccess: () => {
      setOpen(false)
      router.refresh()
    },
    action: (values) => {
      const payload = { ...values, email: values.email || undefined }
      return company
        ? updateFactoringCompanyAction({ companyId: company.id, ...payload })
        : createFactoringCompanyAction(payload)
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {company ? t('finance.factoring.companies.edit') : t('finance.factoring.companies.new')}
          </DialogTitle>
        </DialogHeader>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <TextField<FormValues> name="name" label={t('finance.factoring.companies.fields.name')} required />
          <TextField<FormValues> name="contactName" label={t('finance.factoring.companies.fields.contactName')} />
          <TextField<FormValues> name="email" label={t('finance.factoring.companies.fields.email')} type="email" />
          <TextField<FormValues> name="phone" label={t('finance.factoring.companies.fields.phone')} />
          <TextField<FormValues> name="addressLine1" label={t('finance.factoring.companies.fields.addressLine1')} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField<FormValues> name="addressCity" label={t('finance.factoring.companies.fields.addressCity')} />
            <SelectField<FormValues>
              name="addressState"
              label={t('finance.factoring.companies.fields.addressState')}
              options={STATE_OPTIONS}
            />
            <TextField<FormValues>
              name="addressPostalCode"
              label={t('finance.factoring.companies.fields.addressPostalCode')}
            />
          </div>
          <TextareaField<FormValues>
            name="fundingInstructions"
            label={t('finance.factoring.companies.fields.fundingInstructions')}
            rows={3}
          />
          {company ? (
            <SwitchField<FormValues> name="active" label={t('finance.factoring.companies.fields.active')} />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {company ? t('common.actions.save') : t('common.actions.create')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
