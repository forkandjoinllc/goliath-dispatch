'use client'

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/components/providers/i18n-provider'

export interface ImpersonationBannerProps {
  tenantName: string
  targetUserName: string
  onEndSession: () => void
  isPending?: boolean
}

/**
 * Unmissable while an impersonation session is active. Navy background,
 * safety-orange accent on the action — this is the one place chrome should
 * feel alarming, because it is.
 */
export function ImpersonationBanner({ tenantName, targetUserName, onEndSession, isPending }: ImpersonationBannerProps) {
  const t = useTranslate()
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-safety-500 bg-navy-900 px-4 py-2 text-white"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <ShieldAlert className="size-4 shrink-0 text-safety-500" aria-hidden="true" />
        {t('nav.userMenu.impersonating', { name: targetUserName })} · {tenantName} —{' '}
        {t('nav.impersonation.recorded')}
      </p>
      <Button variant="accent" size="sm" onClick={onEndSession} loading={isPending}>
        {t('nav.userMenu.endImpersonation')}
      </Button>
    </div>
  )
}
