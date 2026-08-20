import { createInertiaApp } from '@inertiajs/react'
import createServer from '@inertiajs/react/server'
import ReactDOMServer from 'react-dom/server'
import { I18nProvider } from '@/lib/i18n'
import { resolvePage } from '@/lib/resolve-page'

const appName = 'Goliath Dispatch'

/**
 * Añade la marca al título SOLO si no la lleva ya.
 *
 * Los títulos SEO de las páginas públicas vienen del diccionario y varios ya
 * empiezan por «Goliath Dispatch — …». Con un sufijo incondicional salía
 * «Goliath Dispatch — Heavy-Haul Dispatch Software · Goliath Dispatch», que en
 * un resultado de búsqueda gasta la mitad de los caracteres visibles repitiendo
 * el nombre.
 */
function pageTitle(title: string): string {
  if (!title) {
    return appName
  }

  return title.includes(appName) ? title : `${title} · ${appName}`
}

createServer((page) =>
  createInertiaApp({
    page,
    render: ReactDOMServer.renderToString,
    title: pageTitle,
    resolve: resolvePage(import.meta.glob('./pages/**/*.tsx')),

    // Misma forma que en app.tsx, y por el mismo motivo: I18nProvider necesita
    // el contexto de página que provee <App>.
    setup: ({ App, props }) => (
      <App {...props}>
        {({ Component, props: pageProps, key }) => (
          <I18nProvider>
            <Component key={key} {...pageProps} />
          </I18nProvider>
        )}
      </App>
    ),
  }),
)
