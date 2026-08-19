'use client'

import * as React from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { getDocumentDownloadUrl } from '@/server/documents/actions'
import { downloadSignatureCertificateAction } from '@/server/signatures/actions'

export function DownloadSignedDocumentButton({ documentId }: { documentId: string }) {
  const t = useTranslate()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await getDocumentDownloadUrl({ documentId })
      if (!result.ok) {
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
        return
      }
      window.open(result.data.url, '_blank', 'noopener,noreferrer')
    })
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleClick} disabled={pending}>
      <Download aria-hidden="true" />
      {t('signature.detail.downloadDocument')}
    </Button>
  )
}

export function DownloadCertificateButton({ requestId }: { requestId: string }) {
  const t = useTranslate()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await downloadSignatureCertificateAction({ requestId })
      if (!result.ok) {
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
        return
      }
      window.open(result.data.url, '_blank', 'noopener,noreferrer')
    })
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleClick} disabled={pending}>
      <Download aria-hidden="true" />
      {t('signature.detail.downloadCertificate')}
    </Button>
  )
}
