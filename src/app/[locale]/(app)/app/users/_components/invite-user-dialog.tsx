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
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/forms/form'
import { SelectField, TextField } from '@/components/forms/fields'
import { useActionForm } from '@/components/forms/use-action-form'
import { useTranslate } from '@/components/providers/i18n-provider'
import { inviteTenantUserAction } from '@/server/users/actions'

const schema = z.object({
  firstName: z.string().trim().min(1, 'validation.required'),
  lastName: z.string().trim().min(1, 'validation.required'),
  email: z.string().trim().min(1, 'validation.required'),
  role: z.enum(['admin', 'accounting', 'dispatcher'], { errorMap: () => ({ message: 'validation.required' }) }),
})

export function InviteUserDialog() {
  const t = useTranslate()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  const { form, onSubmit, isPending } = useActionForm<z.infer<typeof schema>, unknown>({
    schema,
    defaultValues: { firstName: '', lastName: '', email: '', role: 'dispatcher' },
    successMessageKey: 'settings.team.inviteDialog.success',
    onSuccess: () => {
      setOpen(false)
      form.reset({ firstName: '', lastName: '', email: '', role: 'dispatcher' })
      router.refresh()
    },
    action: (values) => inviteTenantUserAction(values),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">{t('settings.team.inviteButton')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.team.inviteDialog.title')}</DialogTitle>
          <DialogDescription>{t('settings.team.inviteDialog.description')}</DialogDescription>
        </DialogHeader>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <TextField name="firstName" label={t('settings.team.inviteDialog.firstName')} required />
          <TextField name="lastName" label={t('settings.team.inviteDialog.lastName')} required />
          <TextField name="email" label={t('settings.team.inviteDialog.email')} type="email" autoComplete="email" required />
          <SelectField
            name="role"
            label={t('settings.team.inviteDialog.role')}
            placeholder={t('settings.team.inviteDialog.rolePlaceholder')}
            required
            options={[
              { value: 'admin', label: t('nav.roles.admin') },
              { value: 'accounting', label: t('nav.roles.accounting') },
              { value: 'dispatcher', label: t('nav.roles.dispatcher') },
            ]}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {t('settings.team.inviteDialog.submit')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
