import type { ReactNode } from 'react'
import { Footer } from '@/components/Marketing/Footer'
import { Header } from '@/components/Marketing/Header'
import { Seo } from '@/components/Marketing/Seo'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

/**
 * El envoltorio de toda página pública: cabecera, pie, SEO y salto al contenido.
 *
 * El enlace «saltar al contenido» va primero en el DOM y solo se ve al enfocarlo.
 * Con seis enlaces de navegación y un conmutador de idioma delante del contenido,
 * quien navega con teclado tendría que pasar por ocho paradas en cada página
 * para llegar al texto.
 */
export function MarketingLayout({
  seo,
  nav,
  alternate,
  year,
  children,
}: MarketingPageProps & { children: ReactNode }) {
  const { t } = useI18n()

  return (
    <>
      <Seo seo={seo} />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-navy-700 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('common.a11y.skipToContent')}
      </a>

      <Header nav={nav} alternate={alternate} />

      <main id="main" className="min-h-[60vh]">
        {children}
      </main>

      <Footer nav={nav} year={year} />
    </>
  )
}
