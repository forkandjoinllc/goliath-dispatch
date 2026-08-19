export const LOCALES = ['en', 'es'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'goliath_locale'
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
}

/** BCP-47 tags used for Intl formatting and the `lang` attribute. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: 'en-US',
  es: 'es-US',
}

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value)
}

export function normalizeLocale(value: string | undefined | null): Locale {
  if (isLocale(value)) return value
  const base = value?.split('-')[0]?.toLowerCase()
  return isLocale(base) ? base : DEFAULT_LOCALE
}

/** Parses an Accept-Language header into our supported set. */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=')
      return { tag: tag?.trim() ?? '', quality: q ? Number(q) : 1 }
    })
    .sort((a, b) => b.quality - a.quality)

  for (const { tag } of ranked) {
    const candidate = normalizeLocaleStrict(tag)
    if (candidate) return candidate
  }
  return DEFAULT_LOCALE
}

function normalizeLocaleStrict(tag: string): Locale | null {
  if (isLocale(tag)) return tag
  const base = tag.split('-')[0]?.toLowerCase()
  return isLocale(base) ? base : null
}
