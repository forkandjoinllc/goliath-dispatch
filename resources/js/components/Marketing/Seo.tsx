import { Head } from '@inertiajs/react'
import type { MarketingSeo } from '@/types/marketing'
import { useI18n } from '@/lib/i18n'

/**
 * Las etiquetas de cabecera de una página pública.
 *
 * Los `hreflang` los calcula el servidor (App\Support\Marketing\Site) y no el
 * cliente: son URLs absolutas y el cliente no conoce con fiabilidad el dominio
 * canónico detrás de un proxy.
 */
export function Seo({ seo }: { seo: MarketingSeo }) {
  const { localeTag } = useI18n()

  return (
    <Head title={seo.title}>
      <meta name="description" content={seo.description} head-key="description" />
      <link rel="canonical" href={seo.canonical} head-key="canonical" />

      {/* Sale como `hrefLang=` en el HTML, no como `hreflang=`: el <Head> de
          Inertia serializa los nombres de prop tal cual, sin pasar por el
          normalizador de atributos de React-DOM.
          Comprobado, no supuesto: los nombres de atributo en HTML son
          insensibles a mayúsculas, y un analizador lo lee como `hreflang`. Es
          cosmético; forzar la minúscula exigiría un cast que apagaría la
          comprobación de tipos de todo el elemento. */}
      {Object.entries(seo.alternates).map(([tag, href]) => (
        <link key={tag} rel="alternate" hrefLang={tag} href={href} head-key={`alt-${tag}`} />
      ))}

      <meta property="og:type" content="website" head-key="og:type" />
      <meta property="og:site_name" content="Goliath Dispatch" head-key="og:site_name" />
      <meta property="og:locale" content={localeTag.replace('-', '_')} head-key="og:locale" />
      <meta property="og:title" content={seo.title} head-key="og:title" />
      <meta property="og:description" content={seo.description} head-key="og:description" />
      <meta property="og:url" content={seo.canonical} head-key="og:url" />
      <meta property="og:image" content={seo.ogImage} head-key="og:image" />
      <meta name="twitter:card" content="summary_large_image" head-key="twitter:card" />
    </Head>
  )
}
