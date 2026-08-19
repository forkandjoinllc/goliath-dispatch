'use client'

import * as React from 'react'
import { CheckCircle2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { downloadSignedArtifactAction } from '@/server/signatures/actions'

export function SuccessScreen({ token, signerEmail }: { token: string; signerEmail: string }) {
  const t = useTranslate()
  const { toast } = useToast()
  const [pending, setPending] = React.useState<'document' | 'certificate' | null>(null)

  async function download(artifact: 'document' | 'certificate') {
    setPending(artifact)
    const result = await downloadSignedArtifactAction({ token, artifact })
    setPending(null)
    if (!result.ok) {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      return
    }
    window.open(result.data.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <CheckCircle2 className="size-12 text-success-600" aria-hidden="true" />
      <h1 className="text-xl font-bold text-carbon">{t('signature.ceremony.successTitle')}</h1>
      <p className="text-sm text-steel-600">{t('signature.ceremony.successDescription', { email: signerEmail })}</p>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <Button variant="secondary" onClick={() => void download('document')} disabled={pending !== null}>
          <Download aria-hidden="true" />
          {t('signature.ceremony.downloadDocument')}
        </Button>
        <Button variant="secondary" onClick={() => void download('certificate')} disabled={pending !== null}>
          <Download aria-hidden="true" />
          {t('signature.ceremony.downloadCertificate')}
        </Button>
      </div>
    </div>
  )
}
