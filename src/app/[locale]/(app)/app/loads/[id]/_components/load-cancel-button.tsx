'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReasonAlertDialog } from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { cancelLoadAction } from '@/server/loads/actions'

export function LoadCancelButton({ loadId }: { loadId: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [isPending, setPending] = React.useState(false)

  async function handleConfirm(reason: string) {
    setPending(true)
    const result = await cancelLoadAction({ loadId, reason })
    setPending(false)
    setOpen(false)
    if (result.ok) {
      toast({ tone: 'success', title: t('load.actions.cancel') })
      router.refresh()
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Ban aria-hidden="true" />
        {t('load.cancel.action')}
      </Button>
      <ReasonAlertDialog
        open={open}
        onOpenChange={setOpen}
        title={t('load.cancel.title')}
        reasonLabel={t('load.cancel.reasonLabel')}
        reasonPlaceholder={t('load.cancel.reasonPlaceholder')}
        cancelLabel={t('load.cancel.cancelAction')}
        confirmLabel={t('load.cancel.confirm')}
        isPending={isPending}
        onConfirm={handleConfirm}
      />
    </>
  )
}
