import { useState } from 'react'
import { Link } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'
import type { MarketingAlternate, MarketingNav } from '@/types/marketing'

/**
 * La cabecera del sitio público.
 *
 * El menú móvil es un `<dialog>`-menos: un panel con `hidden` conmutado, no un
 * portal. Un portal aquí obligaría a que el HTML del servidor y el del cliente
 * coincidieran exactamente durante la hidratación, y el coste no compra nada:
 * son seis enlaces.
 */
export function Header({ nav, alternate }: { nav: MarketingNav; alternate: MarketingAlternate }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-steel-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
        <Link href={nav.home} className="flex shrink-0 items-center gap-3" aria-label="Goliath Dispatch">
          <img
            src="/brand/logo-primary.png"
            srcSet="/brand/logo-primary.png 1x, /brand/logo-primary@2x.png 2x"
            alt="Goliath Dispatch"
            width={168}
            height={40}
            className="h-9 w-auto"
          />
        </Link>

        <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label={t('marketing.header.mobileMenuLabel')}>
          {nav.primary.map((link) => (
            <Link
              key={link.route}
              href={link.href}
              className="rounded px-3 py-2 text-sm font-medium text-navy-800 transition hover:bg-navy-50 hover:text-navy-700"
            >
              {t(link.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {/* Un enlace normal, no un botón con fetch: cambiar de idioma es
              navegar a otra URL, y debe poder abrirse en otra pestaña. */}
          <a
            href={alternate.href}
            lang={alternate.locale}
            hrefLang={alternate.locale}
            className="hidden rounded px-3 py-2 text-sm font-medium text-navy-800 transition hover:bg-navy-50 sm:block"
          >
            {alternate.label}
          </a>

          <Link
            href="/login"
            className="hidden rounded px-3 py-2 text-sm font-medium text-navy-800 transition hover:bg-navy-50 sm:block"
          >
            {t('nav.public.login')}
          </Link>

          <Link
            href="/signup"
            className="rounded bg-safety-600 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700"
          >
            {t('marketing.header.getStartedCta')}
          </Link>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="rounded p-2 text-navy-800 transition hover:bg-navy-50 lg:hidden"
          >
            <span className="sr-only">
              {open ? t('marketing.header.mobileMenuClose') : t('marketing.header.mobileMenuOpen')}
            </span>
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      <div
        id="mobile-nav"
        hidden={!open}
        className="border-t border-steel-200 bg-white lg:hidden"
      >
        <nav className="mx-auto max-w-7xl px-4 py-3 sm:px-6" aria-label={t('marketing.header.mobileMenuLabel')}>
          <ul className="flex flex-col">
            {nav.primary.map((link) => (
              <li key={link.route}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded px-3 py-3 text-base font-medium text-navy-800 hover:bg-navy-50"
                >
                  {t(link.labelKey)}
                </Link>
              </li>
            ))}
            <li className="mt-2 border-t border-steel-200 pt-2">
              <a
                href={alternate.href}
                lang={alternate.locale}
                hrefLang={alternate.locale}
                className="block rounded px-3 py-3 text-base font-medium text-navy-800 hover:bg-navy-50"
              >
                {alternate.label}
              </a>
            </li>
            <li>
              <Link href="/login" className="block rounded px-3 py-3 text-base font-medium text-navy-800 hover:bg-navy-50">
                {t('nav.public.login')}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  )
}
