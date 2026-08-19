import { publicEnv } from '@/lib/env'
import { LOCALES, LOCALE_TAGS, type Locale } from '@/i18n/config'

/**
 * Every marketing route, used by `sitemap.ts`, `robots.ts`, and each page's
 * `generateMetadata` for canonical/hreflang alternates. Keeping this list in
 * one place is what the sitemap-parity unit test checks against.
 */
export const MARKETING_ROUTES = [
  'home',
  'services',
  'heavy-haul',
  'for-carriers',
  'for-clients',
  'about',
  'contact',
  'resources',
  'carrier-signup',
  'privacy',
  'terms',
] as const

export type MarketingRoute = (typeof MARKETING_ROUTES)[number]

export function siteUrl(): string {
  return publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')
}

export function localePath(locale: Locale, route: MarketingRoute | ''): string {
  return route ? `/${locale}/${route}` : `/${locale}`
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`
}

/** `hreflang` alternates for a given route, keyed by BCP-47 tag, plus `x-default`. */
export function languageAlternates(route: MarketingRoute | ''): Record<string, string> {
  const entries = LOCALES.map((locale) => [LOCALE_TAGS[locale], localePath(locale, route)] as const)
  return {
    ...Object.fromEntries(entries),
    'x-default': localePath('en', route),
  }
}
