import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { notFound } from 'next/navigation'
import { SiteHeader } from './_components/site-header'
import { SiteFooter } from './_components/site-footer'
import { resolveMarketingContactBlock } from '@/server/marketing/queries'

/**
 * Shared chrome for every public marketing route: skip link, header (with
 * the mobile nav), footer with the tenant contact block, and nothing else —
 * page content owns its own `<h1>` and landmark structure.
 */
export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) notFound()
  const locale: Locale = rawLocale

  const dictionary = await getDictionary(locale, ['common', 'nav', 'marketing', 'errors', 'validation'])
  const t = createTranslator(dictionary, locale)
  const contact = await resolveMarketingContactBlock(null)

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-navy-700 focus:shadow-[var(--shadow-overlay)]"
      >
        {t('nav.skipToContent')}
      </a>
      <SiteHeader t={t} locale={locale} />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <SiteFooter t={t} locale={locale} contact={contact} />
    </div>
  )
}
