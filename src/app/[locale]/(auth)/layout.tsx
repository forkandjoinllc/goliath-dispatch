import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { LanguageSwitcher } from '@/components/shell/language-switcher'

/**
 * Shared chrome for every pre-authentication page: a navy brand panel on the
 * left (hidden on small screens, where the form takes the full width) and
 * the form card on the right. The language switcher is always reachable —
 * a visitor should never be stuck reading the wrong language before they
 * even have an account.
 */
export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const dictionary = await getDictionary(locale, ['common'])
  const t = createTranslator(dictionary, locale as Locale)

  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-navy-900 p-10 text-white md:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-3 opacity-80"
          style={{
            background:
              'repeating-linear-gradient(135deg, #FF5A00 0, #FF5A00 18px, #062B5C 18px, #062B5C 36px)',
          }}
        />
        <Link href={`/${locale}/home`} className="text-2xl font-black tracking-tight">
          {t('common.appName')}
        </Link>
        <div className="max-w-sm space-y-4">
          <p className="text-3xl font-bold leading-snug">{t('common.tagline')}</p>
        </div>
        <p className="text-xs text-white/60">
          © {new Date().getFullYear()} {t('common.appName')}
        </p>
      </div>

      <div className="flex flex-col">
        <div className="flex justify-end p-4">
          <LanguageSwitcher currentLocale={locale as Locale} label={t('common.labels.language')} />
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  )
}
