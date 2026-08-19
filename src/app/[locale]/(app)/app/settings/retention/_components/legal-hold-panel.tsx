'use client'

import * as React from 'react'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form } from '@/components/forms/form'
import { TextField, TextareaField, SelectField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { ReasonAlertDialog } from '@/components/ui/alert-dialog'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { applyLegalHoldAction, releaseLegalHoldAction } from '@/server/retention/actions'
import type { LegalHold } from '@/db/schema'

const applySchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(200),
  reason: z.string().trim().min(10, 'validation.minLength').max(2000),
  scopeType: z.enum(['tenant', 'entity_type', 'record']),
  entityType: z.string().trim().max(60),
  entityId: z.string().trim().max(36),
})

type ApplyFormValues = z.infer<typeof applySchema>

function ApplyLegalHoldForm({ entityTypes }: { entityTypes: readonly string[] }) {
  const t = useTranslate()
  const { form, onSubmit, isPending } = useActionForm<ApplyFormValues, unknown>({
    schema: applySchema,
    defaultValues: { name: '', reason: '', scopeType: 'tenant', entityType: '', entityId: '' },
    successMessageKey: 'settings.retention.legalHold.applied',
    action: (values) =>
      applyLegalHoldAction({
        name: values.name,
        reason: values.reason,
        scopeType: values.scopeType,
        entityType: values.scopeType === 'tenant' ? undefined : values.entityType || undefined,
        entityId: values.scopeType === 'record' ? values.entityId || undefined : undefined,
      }),
    onSuccess: () => form.reset({ name: '', reason: '', scopeType: 'tenant', entityType: '', entityId: '' }),
  })

  const scopeType = form.watch('scopeType')

  return (
    <Form form={form} onSubmit={onSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<ApplyFormValues> name="name" label={t('settings.retention.legalHold.name')} required />
        <SelectField<ApplyFormValues>
          name="scopeType"
          label={t('settings.retention.legalHold.scopeType')}
          options={[
            { value: 'tenant', label: t('settings.retention.legalHold.scopeTenant') },
            { value: 'entity_type', label: t('settings.retention.legalHold.scopeEntityType') },
            { value: 'record', label: t('settings.retention.legalHold.scopeRecord') },
          ]}
        />
        {scopeType !== 'tenant' ? (
          <SelectField<ApplyFormValues>
            name="entityType"
            label={t('settings.retention.legalHold.entityType')}
            options={entityTypes.map((type) => ({ value: type, label: type }))}
          />
        ) : null}
        {scopeType === 'record' ? (
          <TextField<ApplyFormValues> name="entityId" label={t('settings.retention.legalHold.entityId')} required />
        ) : null}
        <TextareaField<ApplyFormValues>
          name="reason"
          label={t('settings.retention.legalHold.reason')}
          description={t('settings.retention.legalHold.reasonHint')}
          required
          className="sm:col-span-2"
        />
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="submit" loading={isPending}>
          {t('settings.retention.legalHold.apply')}
        </Button>
      </div>
    </Form>
  )
}

function ReleaseButton({ hold, onReleased }: { hold: LegalHold; onReleased: () => void }) {
  const t = useTranslate()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  return (
    <>
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        {t('settings.retention.legalHold.release')}
      </Button>
      <ReasonAlertDialog
        open={open}
        onOpenChange={setOpen}
        title={t('settings.retention.legalHold.releaseTitle')}
        description={t('settings.retention.legalHold.releaseDescription', { name: hold.name })}
        reasonLabel={t('settings.retention.legalHold.releaseReason')}
        cancelLabel={t('common.actions.cancel')}
        confirmLabel={t('settings.retention.legalHold.release')}
        isPending={isPending}
        onConfirm={(reason) => {
          startTransition(async () => {
            const result = await releaseLegalHoldAction({ legalHoldId: hold.id, releaseReason: reason })
            if (result.ok) {
              setOpen(false)
              onReleased()
            }
          })
        }}
      />
    </>
  )
}

export function LegalHoldPanel({
  canManage,
  entityTypes,
  activeHolds,
  history,
}: {
  canManage: boolean
  entityTypes: readonly string[]
  activeHolds: LegalHold[]
  history: LegalHold[]
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const [holds, setHolds] = React.useState(activeHolds)
  const released = history.filter((h) => h.releasedAt)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.retention.legalHold.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {canManage ? <ApplyLegalHoldForm entityTypes={entityTypes} /> : null}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-steel-600">{t('settings.retention.legalHold.active')}</p>
          {holds.length === 0 ? (
            <EmptyState title={t('settings.retention.legalHold.noneActive')} />
          ) : (
            <ul className="space-y-2">
              {holds.map((hold) => (
                <li key={hold.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-500/40 bg-warning-50 p-3">
                  <div>
                    <p className="text-sm font-semibold text-carbon">{hold.name}</p>
                    <p className="text-xs text-steel-600">{hold.reason}</p>
                    <p className="mt-1 text-xs text-steel-500">
                      <Badge tone="warning">{t(`settings.retention.legalHold.scope.${hold.scopeType}`)}</Badge>{' '}
                      {hold.entityType ? `${hold.entityType}${hold.entityId ? ` · ${hold.entityId}` : ''}` : null}
                      {' · '}
                      {formatDateTime(hold.appliedAt, locale, timezone)}
                    </p>
                  </div>
                  {canManage ? (
                    <ReleaseButton hold={hold} onReleased={() => setHolds((prev) => prev.filter((h) => h.id !== hold.id))} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {released.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-steel-600">{t('settings.retention.legalHold.released')}</p>
            <ul className="space-y-1.5">
              {released.map((hold) => (
                <li key={hold.id} className="rounded-md border border-steel-200 p-3 text-xs text-steel-600">
                  <span className="font-semibold text-carbon">{hold.name}</span> — {hold.releaseReason}
                  <span className="ml-2 text-steel-400">{hold.releasedAt ? formatDateTime(hold.releasedAt, locale, timezone) : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
