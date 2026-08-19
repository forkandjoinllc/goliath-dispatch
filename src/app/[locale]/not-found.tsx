'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/components/providers/i18n-provider'
import { normalizeLocale } from '@/i18n/config'

/**
 * App-router `not-found.tsx` for the `[locale]` segment — this is what
 * renders in place of Next's unstyled, unlocalized default 404 page whenever
 * a route doesn't match or a page calls `notFound()` (see `@/lib/errors`).
 * Nested under `[locale]/layout.tsx`, so `I18nProvider` is already mounted.
 */
export default function LocaleNotFound() {
  const t = useTranslate()
  const params = useParams<{ locale?: string }>()
  const locale = normalizeLocale(params?.locale)

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-carbon">{t('common.boundary.notFoundTitle')}</h1>
      <p className="max-w-md text-sm text-steel-600">{t('common.boundary.notFoundDescription')}</p>
      <Button asChild>
        <Link href={`/${locale}/app`}>{t('common.boundary.goHome')}</Link>
      </Button>
    </main>
  )
}
