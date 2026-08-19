'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReasonAlertDialog } from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { voidSignatureRequestAction } from '@/server/signatures/actions'

export function VoidRequestButton({ requestId }: { requestId: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  function handleConfirm(reason: string) {
    startTransition(async () => {
      const result = await voidSignatureRequestAction({ requestId, reason })
      if (!result.ok) {
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Ban aria-hidden="true" />
        {t('signature.detail.voidAction')}
      </Button>
      <ReasonAlertDialog
        open={open}
        onOpenChange={setOpen}
        title={t('signature.detail.voidDialogTitle')}
        description={t('signature.detail.voidDialogDescription')}
        reasonLabel={t('signature.detail.reasonLabel')}
        reasonPlaceholder={t('signature.detail.reasonPlaceholder')}
        cancelLabel={t('common.actions.cancel')}
        confirmLabel={t('signature.detail.voidAction')}
        isPending={isPending}
        onConfirm={handleConfirm}
      />
    </>
  )
}
