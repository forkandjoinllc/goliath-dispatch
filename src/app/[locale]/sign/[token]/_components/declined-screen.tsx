'use client'

import { XCircle } from 'lucide-react'
import { useTranslate } from '@/components/providers/i18n-provider'

export function DeclinedScreen() {
  const t = useTranslate()
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <XCircle className="size-12 text-danger-600" aria-hidden="true" />
      <h1 className="text-xl font-bold text-carbon">{t('signature.ceremony.declinedTitle')}</h1>
      <p className="text-sm text-steel-600">{t('signature.ceremony.declinedDescription')}</p>
    </div>
  )
}
