'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/components/providers/i18n-provider'
import { normalizeLocale } from '@/i18n/config'

/**
 * App-router `error.tsx` for the `[locale]` segment — catches an otherwise
 * uncaught render error so a visitor sees a branded, localized message with
 * a way back into the app instead of Next's default unstyled error screen.
 * The originating error is already logged server-side (see `defineAction`/
 * `loadFor` in `@/server/action.ts`); this boundary never re-surfaces raw
 * error text to the user.
 */
export default function LocaleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslate()
  const params = useParams<{ locale?: string }>()
  const locale = normalizeLocale(params?.locale)

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 py-16 text-center" role="alert">
      <h1 className="text-2xl font-bold text-carbon">{t('common.boundary.errorTitle')}</h1>
      <p className="max-w-md text-sm text-steel-600">{t('common.boundary.errorDescription')}</p>
      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => reset()}>
          {t('common.boundary.tryAgain')}
        </Button>
        <Button asChild>
          <Link href={`/${locale}/app`}>{t('common.boundary.goHome')}</Link>
        </Button>
      </div>
    </main>
  )
}
