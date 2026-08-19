'use client'

import * as React from 'react'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField, SelectField, CheckboxField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import {
  createEquipmentTypeAction,
  deleteEquipmentTypeAction,
  setEquipmentTypeActiveAction,
} from '@/server/equipment/actions'
import type { EquipmentType } from '@/db/schema'

const schema = z.object({
  code: z.string().trim().min(1, 'validation.required').max(40),
  labelEn: z.string().trim().min(1, 'validation.required').max(120),
  labelEs: z.string().trim().min(1, 'validation.required').max(120),
  category: z.enum(['truck', 'trailer']),
  supportsRgn: z.boolean(),
})

export function EquipmentTypesManager({ types }: { types: EquipmentType[] }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const { form, onSubmit, isPending: isCreating } = useActionForm({
    schema,
    defaultValues: { code: '', labelEn: '', labelEs: '', category: 'trailer' as const, supportsRgn: false },
    action: (values) => createEquipmentTypeAction(values),
    onSuccess: () => {
      form.reset({ code: '', labelEn: '', labelEs: '', category: 'trailer', supportsRgn: false })
      router.refresh()
    },
    successMessageKey: 'equipment.types.new',
  })

  function toggleActive(typeItem: EquipmentType) {
    startTransition(async () => {
      const result = await setEquipmentTypeActiveAction({ typeId: typeItem.id, active: !typeItem.active })
      if (result.ok) {
        toast({ tone: 'success', title: t(typeItem.active ? 'equipment.types.deactivate' : 'equipment.types.reactivate') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function remove(typeItem: EquipmentType) {
    if (!window.confirm(t('equipment.types.confirmDelete', { label: typeItem.labelEn }))) return
    startTransition(async () => {
      const result = await deleteEquipmentTypeAction({ typeId: typeItem.id })
      if (result.ok) {
        toast({ tone: 'success', title: t('equipment.types.delete') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('equipment.types.new')}</CardTitle>
          <CardDescription>{t('equipment.types.description')}</CardDescription>
        </CardHeader>
        <Form form={form} onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <FormErrorSummary title={t('errors.validationFailed')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="code" label={t('equipment.types.code')} required />
              <SelectField
                name="category"
                label={t('equipment.types.category')}
                required
                options={[
                  { value: 'truck', label: t('equipment.types.categoryTruck') },
                  { value: 'trailer', label: t('equipment.types.categoryTrailer') },
                ]}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="labelEn" label={t('equipment.types.labelEn')} required />
              <TextField name="labelEs" label={t('equipment.types.labelEs')} required />
            </div>
            <CheckboxField name="supportsRgn" label={t('equipment.types.supportsRgn')} />
          </CardContent>
          <CardFooter>
            <Button type="submit" loading={isCreating} loadingLabel={t('common.states.saving')}>
              {t('equipment.types.new')}
            </Button>
          </CardFooter>
        </Form>
      </Card>

      {types.length === 0 ? (
        <p className="text-sm text-steel-600">{t('equipment.types.empty')}</p>
      ) : (
        <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
          {types.map((typeItem) => (
            <li key={typeItem.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div>
                <p className="font-semibold text-carbon">
                  {typeItem.labelEn}
                  <span className="ml-2 font-mono text-xs text-steel-500">{typeItem.code}</span>
                  {typeItem.isSystem ? (
                    <Badge tone="neutral" className="ml-2">
                      {t('equipment.types.systemBadge')}
                    </Badge>
                  ) : null}
                  {!typeItem.active ? (
                    <Badge tone="neutral" className="ml-2">
                      {t('equipment.status.archived')}
                    </Badge>
                  ) : null}
                </p>
                <p className="text-xs text-steel-500">{typeItem.labelEs}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={isPending} onClick={() => toggleActive(typeItem)}>
                  {t(typeItem.active ? 'equipment.types.deactivate' : 'equipment.types.reactivate')}
                </Button>
                {!typeItem.isSystem ? (
                  <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={() => remove(typeItem)}>
                    {t('equipment.types.delete')}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
