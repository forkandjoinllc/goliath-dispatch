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
import { Alert } from '@/components/ui/feedback'
import { Form, FormField } from '@/components/forms/form'
import { SelectField } from '@/components/forms/fields'
import { useActionForm } from '@/components/forms/use-action-form'
import { useTranslate } from '@/components/providers/i18n-provider'
import { createFactoringAssignmentAction } from '@/server/factoring/actions'
import { searchCarriersForFactoringAction } from '@/server/finance/actions'
import { EntityCombobox } from './entity-combobox'
import type { FactoringCompany } from '@/db/schema'

const schema = z.object({
  carrierId: z.string().uuid({ message: 'validation.required' }),
  factoringCompanyId: z.string().uuid({ message: 'validation.required' }),
})

export function AssignmentFormDialog({ companies }: { companies: FactoringCompany[] }) {
  const t = useTranslate()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [carrierLabel, setCarrierLabel] = React.useState<string | null>(null)

  const { form, onSubmit, isPending } = useActionForm<z.infer<typeof schema>, unknown>({
    schema,
    defaultValues: { carrierId: '', factoringCompanyId: '' },
    successMessageKey: 'finance.factoring.assignments.createSuccess',
    onSuccess: () => {
      setOpen(false)
      setCarrierLabel(null)
      router.refresh()
    },
    action: (values) => createFactoringAssignmentAction(values),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">{t('finance.factoring.assignments.new')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('finance.factoring.assignments.new')}</DialogTitle>
        </DialogHeader>
        <Alert tone="info">{t('finance.factoring.manualNoticeShort')}</Alert>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <FormField<z.infer<typeof schema>>
            name="carrierId"
            label={t('finance.factoring.assignments.fields.carrier')}
            required
            render={(bind) => (
              // Forward `bind.id` so `<Label htmlFor>` matches the rendered
              // control's id (see the identical fix on
              // `generate-settlement-form.tsx`).
              <EntityCombobox
                id={bind.id}
                invalid={bind.invalid}
                aria-describedby={bind['aria-describedby']}
                value={form.watch('carrierId') || null}
                selectedLabel={carrierLabel}
                onChange={(value, label) => {
                  form.setValue('carrierId', value ?? '', { shouldValidate: true })
                  setCarrierLabel(label)
                }}
                search={async (query) => {
                  const result = await searchCarriersForFactoringAction({ query })
                  return result.ok ? result.data : []
                }}
              />
            )}
          />
          <SelectField<z.infer<typeof schema>>
            name="factoringCompanyId"
            label={t('finance.factoring.assignments.fields.factoringCompany')}
            required
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {t('common.actions.create')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
