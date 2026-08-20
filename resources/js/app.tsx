import '../css/app.css'

import { createInertiaApp } from '@inertiajs/react'
import { createRoot, hydrateRoot } from 'react-dom/client'
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

void createInertiaApp({
  title: pageTitle,

  resolve: resolvePage(import.meta.glob('./pages/**/*.tsx')),

  setup({ el, App, props }) {
    if (el === null) {
      throw new Error('Inertia no encontró su elemento raíz (#app).')
    }

    // I18nProvider va DENTRO de <App>, no envolviéndolo.
    //
    // Envolver `<I18nProvider><App/></I18nProvider>` parece equivalente y no lo
    // es: el contexto de página lo provee <App>, así que el usePage() de
    // I18nProvider quedaría fuera de él y revienta con «usePage must be used
    // within the Inertia component». En cliente el fallo es una pantalla en
    // blanco; en SSR, una página sin nada que indexar.
    //
    // La forma con children es la que da acceso al componente ya resuelto.
    const tree = (
      <App {...props}>
        {({ Component, props: pageProps, key }) => (
          <I18nProvider>
            <Component key={key} {...pageProps} />
          </I18nProvider>
        )}
      </App>
    )

    // Si el servidor renderizó (SSR), se hidrata; si no, se monta. Las páginas
    // públicas se renderizan en el servidor para que un buscador vea el texto y
    // no un div vacío — es un sitio de marketing, la indexación es el punto.
    if (el.hasChildNodes()) {
      hydrateRoot(el, tree)

      return
    }

    createRoot(el).render(tree)
  },

  progress: {
    color: '#FF5A00',
    showSpinner: false,
  },
})
