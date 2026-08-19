'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField, TextareaField, PhoneField, CheckboxField } from '@/components/forms/fields'
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { CustomerContact } from '@/db/schema'
import {
  createCustomerContactAction,
  deleteCustomerContactAction,
  setPrimaryCustomerContactAction,
  updateCustomerContactAction,
} from '@/server/customers/actions'

const contactSchema = z.object({
  firstName: z.string().trim().min(1, 'validation.required').max(100),
  lastName: z.string().trim().min(1, 'validation.required').max(100),
  email: z.string().trim(),
  phone: z.string().trim(),
  phoneExtension: z.string().trim(),
  position: z.string().trim(),
  isPrimary: z.boolean(),
  notes: z.string().trim(),
})
type ContactFormValues = z.infer<typeof contactSchema>

function toNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function ContactFormDialog({
  customerId,
  contact,
  open,
  onOpenChange,
}: {
  customerId: string
  contact: CustomerContact | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslate()
  const router = useRouter()

  const { form, onSubmit, isPending } = useActionForm<ContactFormValues, { id: string }>({
    schema: contactSchema,
    defaultValues: {
      firstName: contact?.firstName ?? '',
      lastName: contact?.lastName ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      phoneExtension: contact?.phoneExtension ?? '',
      position: contact?.position ?? '',
      isPrimary: contact?.isPrimary ?? false,
      notes: contact?.notes ?? '',
    },
    action: (values) => {
      const payload = {
        firstName: values.firstName,
        lastName: values.lastName,
        email: toNullable(values.email),
        phone: toNullable(values.phone),
        phoneExtension: toNullable(values.phoneExtension),
        position: toNullable(values.position),
        isPrimary: values.isPrimary,
        notes: toNullable(values.notes),
      }
      return contact
        ? updateCustomerContactAction({ contactId: contact.id, ...payload })
        : createCustomerContactAction({ customerId, ...payload })
    },
    onSuccess: () => {
      onOpenChange(false)
      router.refresh()
    },
    successMessageKey: contact ? 'common.actions.save' : 'common.actions.create',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t(contact ? 'customer.contacts.edit' : 'customer.contacts.add')}</DialogTitle>
          </DialogHeader>
          <FormErrorSummary title={t('errors.validationFailed')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="firstName" label={t('customer.contacts.fields.firstName')} required />
            <TextField name="lastName" label={t('customer.contacts.fields.lastName')} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="email" label={t('customer.contacts.fields.email')} type="email" />
            <PhoneField name="phone" label={t('customer.contacts.fields.phone')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="phoneExtension" label={t('customer.contacts.fields.phoneExtension')} />
            <TextField name="position" label={t('customer.contacts.fields.position')} />
          </div>
          <CheckboxField name="isPrimary" label={t('customer.contacts.fields.isPrimary')} />
          <TextareaField name="notes" label={t('customer.contacts.fields.notes')} rows={3} />
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

export function ContactsPanel({
  customerId,
  contacts,
  canManage,
}: {
  customerId: string
  contacts: CustomerContact[]
  canManage: boolean
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [dialogState, setDialogState] = React.useState<{ open: boolean; contact: CustomerContact | null }>({
    open: false,
    contact: null,
  })
  const [deleteTarget, setDeleteTarget] = React.useState<CustomerContact | null>(null)
  const [isPending, setPending] = React.useState(false)

  async function handleSetPrimary(contact: CustomerContact) {
    setPending(true)
    const result = await setPrimaryCustomerContactAction({ customerId, contactId: contact.id })
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
    const result = await deleteCustomerContactAction({ contactId: deleteTarget.id })
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
        <h3 className="text-base font-bold text-carbon">{t('customer.contacts.title')}</h3>
        {canManage ? (
          <Button size="sm" onClick={() => setDialogState({ open: true, contact: null })}>
            <Plus aria-hidden="true" />
            {t('customer.contacts.add')}
          </Button>
        ) : null}
      </div>

      {contacts.length === 0 ? (
        <EmptyState title={t('customer.contacts.empty')} />
      ) : (
        <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-carbon">
                    {contact.firstName} {contact.lastName}
                  </span>
                  {contact.isPrimary ? <Badge tone="navy">{t('customer.contacts.primary')}</Badge> : null}
                </div>
                <p className="text-sm text-steel-600">
                  {[contact.position, contact.email, contact.phone].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              {canManage ? (
                <div className="flex items-center gap-1">
                  {!contact.isPrimary ? (
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={t('customer.contacts.setPrimary')}
                      disabled={isPending}
                      onClick={() => handleSetPrimary(contact)}
                    >
                      <Star aria-hidden="true" />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={t('common.actions.edit')}
                    onClick={() => setDialogState({ open: true, contact })}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={t('customer.contacts.delete')}
                    onClick={() => setDeleteTarget(contact)}
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
        <ContactFormDialog
          customerId={customerId}
          contact={dialogState.contact}
          open={dialogState.open}
          onOpenChange={(open) => setDialogState((prev) => ({ ...prev, open }))}
        />
      ) : null}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('customer.contacts.delete')}</AlertDialogTitle>
            <AlertDialogDescription>{t('customer.contacts.deleteConfirm')}</AlertDialogDescription>
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
