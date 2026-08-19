import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
// Fonts are self-hosted from npm rather than fetched from Google Fonts: no
// third-party request at runtime, no CSP exception, and the build works in an
// air-gapped CI environment.
import '@fontsource-variable/inter'
import '@fontsource/roboto-condensed/400.css'
import '@fontsource/roboto-condensed/700.css'
import { LOCALES, LOCALE_TAGS, isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { I18nProvider } from '@/components/providers/i18n-provider'
import { ToastProvider } from '@/components/ui/toast'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  const dictionary = await getDictionary(locale, ['common', 'marketing'])
  const marketing = dictionary.marketing as Record<string, { title?: string; description?: string }>
  return {
    title: {
      default: (marketing?.meta?.title as string) ?? 'Goliath Dispatch',
      template: '%s · Goliath Dispatch',
    },
    description: (marketing?.meta?.description as string) ?? undefined,
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(LOCALES.map((l) => [LOCALE_TAGS[l], `/${l}`])),
    },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const dictionary = await getDictionary(locale)

  return (
    <html lang={LOCALE_TAGS[locale]}>
      <body className="min-h-dvh antialiased">
        <I18nProvider locale={locale} timezone="America/New_York" dictionary={dictionary}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
