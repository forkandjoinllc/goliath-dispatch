import type { Locale } from '@/i18n/config'
import type { TranslateFn } from '@/i18n/translate'
import { localePath } from '../_lib/site'

export interface MarketingNavLink {
  href: string
  label: string
}

/**
 * The primary nav shown in the header and the mobile drawer. `resources` and
 * `about` are intentionally left off the primary bar to keep it scannable —
 * they're reachable from the footer — mirroring how the header/footer split
 * works in `src/components/shell/sidebar-nav.tsx` for the authenticated app.
 */
export function primaryNavLinks(t: TranslateFn, locale: Locale): MarketingNavLink[] {
  return [
    { href: localePath(locale, 'services'), label: t('nav.public.services') },
    { href: localePath(locale, 'heavy-haul'), label: t('nav.public.heavyHaul') },
    { href: localePath(locale, 'for-carriers'), label: t('nav.public.forCarriers') },
    { href: localePath(locale, 'for-clients'), label: t('nav.public.forClients') },
    { href: localePath(locale, 'about'), label: t('nav.public.about') },
    { href: localePath(locale, 'contact'), label: t('nav.public.contact') },
  ]
}

export function footerProductLinks(t: TranslateFn, locale: Locale): MarketingNavLink[] {
  return [
    { href: localePath(locale, 'services'), label: t('nav.public.services') },
    { href: localePath(locale, 'heavy-haul'), label: t('nav.public.heavyHaul') },
    { href: localePath(locale, 'for-carriers'), label: t('nav.public.forCarriers') },
    { href: localePath(locale, 'for-clients'), label: t('nav.public.forClients') },
  ]
}

export function footerCompanyLinks(t: TranslateFn, locale: Locale): MarketingNavLink[] {
  return [
    { href: localePath(locale, 'about'), label: t('nav.public.about') },
    { href: localePath(locale, 'contact'), label: t('nav.public.contact') },
    { href: localePath(locale, 'resources'), label: t('nav.public.resources') },
    { href: localePath(locale, 'carrier-signup'), label: t('nav.public.carrierSignup') },
  ]
}

export function footerLegalLinks(t: TranslateFn, locale: Locale): MarketingNavLink[] {
  return [
    { href: localePath(locale, 'privacy'), label: t('nav.public.privacy') },
    { href: localePath(locale, 'terms'), label: t('nav.public.terms') },
  ]
}
