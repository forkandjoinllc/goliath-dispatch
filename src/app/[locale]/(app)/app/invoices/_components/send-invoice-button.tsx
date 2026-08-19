'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { sendInvoiceAction } from '@/server/invoices/actions'

export function SendInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function send() {
    if (!window.confirm(t('finance.invoice.actions.sendConfirm'))) return
    startTransition(async () => {
      const result = await sendInvoiceAction({ invoiceId })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.invoice.actions.sentToast') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Button type="button" disabled={isPending} onClick={send}>
      {t('finance.invoice.actions.send')}
    </Button>
  )
}
