'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Languages } from 'lucide-react'
import { LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_LABELS, type Locale } from '@/i18n/config'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

/**
 * Swaps the `/{locale}/…` segment of the current path, preserves the query
 * string, and sets the locale cookie so the choice survives navigation that
 * isn't through this switcher (emails, bookmarks).
 *
 * The query string is read from `window.location.search` at click time rather
 * than through `useSearchParams()`. The hook opts the whole subtree out of
 * static prerendering — which would deopt every marketing and auth page that
 * renders this switcher — and it buys nothing here, because the value is only
 * needed inside an event handler where `window` is guaranteed to exist.
 */
export function LanguageSwitcher({ currentLocale, label }: { currentLocale: Locale; label: string }) {
  const pathname = usePathname()
  const router = useRouter()

  function switchTo(locale: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`
    const segments = (pathname ?? '/').split('/')
    if (segments[1] && (LOCALES as readonly string[]).includes(segments[1])) {
      segments[1] = locale
    } else {
      segments.splice(1, 0, locale)
    }
    const query = typeof window === 'undefined' ? '' : window.location.search
    router.push(`${segments.join('/') || '/'}${query}`)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label}>
          <Languages aria-hidden="true" />
          <span className="hidden sm:inline">{LOCALE_LABELS[currentLocale]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((locale) => (
          <DropdownMenuItem key={locale} onSelect={() => switchTo(locale)} aria-current={locale === currentLocale}>
            {LOCALE_LABELS[locale]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
