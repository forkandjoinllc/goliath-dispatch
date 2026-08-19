'use client'

import * as React from 'react'
import type { Dictionary } from '@/i18n/dictionary'
import { createTranslator, type TranslateFn } from '@/i18n/translate'
import type { Locale } from '@/i18n/config'

/**
 * Client-side translation.
 *
 * Server components call `getDictionary` directly; client components read from
 * this context. The dictionary crosses the boundary as plain JSON, so there is
 * no duplicate fetch and no flash of untranslated content.
 */

interface I18nValue {
  locale: Locale
  timezone: string
  t: TranslateFn
}

const I18nContext = React.createContext<I18nValue | null>(null)

export function I18nProvider({
  locale,
  timezone,
  dictionary,
  children,
}: {
  locale: Locale
  timezone: string
  dictionary: Dictionary
  children: React.ReactNode
}) {
  const value = React.useMemo<I18nValue>(
    () => ({ locale, timezone, t: createTranslator(dictionary, locale) }),
    [locale, timezone, dictionary],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const context = React.useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>')
  return context
}

/** Shorthand: `const t = useTranslate()`. */
export function useTranslate(): TranslateFn {
  return useI18n().t
}
