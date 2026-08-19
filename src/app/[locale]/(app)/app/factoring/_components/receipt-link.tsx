'use client'

import * as React from 'react'
import { useTransition } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { getDocumentDownloadUrl } from '@/server/documents/actions'

/** Opens a fresh signed URL on click rather than embedding one — signed URLs expire. */
export function ReceiptLink({ documentId }: { documentId: string }) {
  const t = useTranslate()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function open() {
    startTransition(async () => {
      const result = await getDocumentDownloadUrl({ documentId })
      if (result.ok) {
        window.open(result.data.url, '_blank', 'noopener,noreferrer')
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-700 underline underline-offset-2 hover:no-underline disabled:opacity-50"
    >
      {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}
      {t('common.actions.download')}
    </button>
  )
}
