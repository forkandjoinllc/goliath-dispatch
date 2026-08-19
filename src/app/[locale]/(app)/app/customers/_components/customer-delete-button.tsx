'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReasonAlertDialog } from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { deleteCustomerAction } from '@/server/customers/actions'

export function CustomerDeleteButton({ customerId, locale }: { customerId: string; locale: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [isPending, setPending] = React.useState(false)

  async function handleConfirm(reason: string) {
    setPending(true)
    const result = await deleteCustomerAction({ customerId, reason: reason || undefined })
    setPending(false)
    if (result.ok) {
      toast({ tone: 'success', title: t('common.actions.delete') })
      router.push(`/${locale}/app/customers`)
      router.refresh()
      return
    }
    setOpen(false)
    toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" />
        {t('customer.actions.delete')}
      </Button>
      <ReasonAlertDialog
        open={open}
        onOpenChange={setOpen}
        title={t('customer.actions.delete')}
        description={t('customer.actions.deleteConfirm')}
        reasonLabel={t('common.labels.reason')}
        cancelLabel={t('common.actions.cancel')}
        confirmLabel={t('common.actions.delete')}
        isPending={isPending}
        onConfirm={handleConfirm}
      />
    </>
  )
}
