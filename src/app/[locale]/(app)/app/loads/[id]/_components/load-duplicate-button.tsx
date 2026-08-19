'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { duplicateLoadAction } from '@/server/loads/actions'

export function LoadDuplicateButton({ loadId, locale }: { loadId: string; locale: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [isPending, setPending] = React.useState(false)

  async function handleConfirm() {
    setPending(true)
    const result = await duplicateLoadAction({ loadId })
    setPending(false)
    setOpen(false)
    if (result.ok) {
      toast({ tone: 'success', title: t('load.duplicate.action') })
      router.push(`/${locale}/app/loads/${result.data.load.id}`)
      router.refresh()
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Copy aria-hidden="true" />
        {t('load.duplicate.action')}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('load.duplicate.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('load.duplicate.confirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('load.duplicate.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={handleConfirm}>
              {t('load.duplicate.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
