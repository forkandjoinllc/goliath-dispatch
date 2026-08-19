'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField, TextareaField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { createDispatcherGroup } from '@/server/carriers/actions'
import { renameGroupAction, setGroupActiveAction } from '@/server/assignments/actions'
import type { DispatcherGroupView } from '@/server/assignments/queries'

const schema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(120),
  description: z.string().trim(),
})

export function DispatcherGroupsPanel({ groups }: { groups: DispatcherGroupView[] }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [renaming, setRenaming] = React.useState<Record<string, string>>({})

  const { form, onSubmit, isPending: isCreating } = useActionForm({
    schema,
    defaultValues: { name: '', description: '' },
    action: (values) => createDispatcherGroup({ name: values.name, description: values.description.trim() || null }),
    onSuccess: () => {
      form.reset({ name: '', description: '' })
      router.refresh()
    },
    successMessageKey: 'assignment.groups.title',
  })

  function rename(groupId: string) {
    const name = renaming[groupId]?.trim()
    if (!name) return
    startTransition(async () => {
      const result = await renameGroupAction({ groupId, name })
      if (result.ok) {
        toast({ tone: 'success', title: t('assignment.groups.rename') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function toggleActive(groupId: string, groupName: string, active: boolean) {
    if (active && !window.confirm(t('assignment.groups.confirmDeactivate', { groupName }))) return
    startTransition(async () => {
      const result = await setGroupActiveAction({ groupId, active: !active })
      if (result.ok) {
        toast({ tone: 'success', title: t(active ? 'assignment.groups.deactivate' : 'assignment.groups.reactivate') })
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
          <CardTitle>{t('assignment.groups.title')}</CardTitle>
          <CardDescription>{t('assignment.groups.description')}</CardDescription>
        </CardHeader>
        <Form form={form} onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <FormErrorSummary title={t('errors.validationFailed')} />
            <TextField name="name" label={t('common.labels.name')} required />
            <TextareaField name="description" label={t('common.labels.notes')} rows={2} />
          </CardContent>
          <CardFooter>
            <Button type="submit" loading={isCreating} loadingLabel={t('common.states.saving')}>
              {t('common.actions.create')}
            </Button>
          </CardFooter>
        </Form>
      </Card>

      {groups.length === 0 ? (
        <EmptyState title={t('assignment.groups.empty')} />
      ) : (
        <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
          {groups.map(({ group, ownerName, memberCount }) => (
            <li key={group.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div>
                <p className="font-semibold text-carbon">
                  {group.name}
                  {!group.active ? (
                    <Badge tone="neutral" className="ml-2">
                      {t('equipment.status.archived')}
                    </Badge>
                  ) : null}
                </p>
                <p className="text-xs text-steel-500">
                  {t('assignment.groups.owner')}: {ownerName ?? t('common.labels.none')} · {t('assignment.groups.memberCount', { count: memberCount })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  defaultValue={group.name}
                  onChange={(event) => setRenaming((prev) => ({ ...prev, [group.id]: event.target.value }))}
                  className="h-8 rounded-md border border-steel-300 px-2 text-xs"
                />
                <Button type="button" variant="secondary" size="sm" disabled={isPending} onClick={() => rename(group.id)}>
                  {t('assignment.groups.rename')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isPending}
                  onClick={() => toggleActive(group.id, group.name, group.active)}
                >
                  {t(group.active ? 'assignment.groups.deactivate' : 'assignment.groups.reactivate')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
