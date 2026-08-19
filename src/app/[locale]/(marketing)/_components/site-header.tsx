import Link from 'next/link'
import type { Locale } from '@/i18n/config'
import type { TranslateFn } from '@/i18n/translate'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/shell/language-switcher'
import { primaryNavLinks } from './nav-links'
import { MobileNav } from './mobile-nav'
import { localePath } from '../_lib/site'

export function SiteHeader({ t, locale }: { t: TranslateFn; locale: Locale }) {
  const links = primaryNavLinks(t, locale)

  return (
    <header className="sticky top-0 z-40 border-b border-steel-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href={localePath(locale, 'home')}
          className="flex shrink-0 items-center rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-full.svg" alt={t('marketing.illustrations.logoAlt')} className="h-9 w-auto" />
        </Link>

        <nav aria-label={t('marketing.header.mobileMenuLabel')} className="hidden md:flex md:items-center md:gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-semibold text-navy-700 transition-colors hover:bg-navy-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitcher currentLocale={locale} label={t('common.labels.language')} />
          <Button asChild variant="secondary" size="sm" className="hidden sm:inline-flex">
            <Link href={`${localePath(locale, 'for-clients')}#quote`}>{t('marketing.header.requestQuoteCta')}</Link>
          </Button>
          <Button asChild variant="accent" size="sm" className="hidden sm:inline-flex">
            <Link href={`/${locale}/signup`}>{t('marketing.header.getStartedCta')}</Link>
          </Button>
          <MobileNav
            links={links}
            openLabel={t('marketing.header.mobileMenuOpen')}
            closeLabel={t('marketing.header.mobileMenuClose')}
            navLabel={t('marketing.header.mobileMenuLabel')}
            ctaHref={`/${locale}/signup`}
            ctaLabel={t('marketing.header.getStartedCta')}
          />
        </div>
      </div>
    </header>
  )
}
