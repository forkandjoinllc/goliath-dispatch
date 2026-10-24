import { router } from '@inertiajs/react'
import type { ReactNode } from 'react'

/**
 * El menú horizontal de secciones.
 *
 * ## La pestaña vive en la URL, no en el estado del componente
 *
 * Es la decisión que sostiene todo lo demás. Con la pestaña en `useState`:
 *
 *  • guardar devuelve `back()`, el componente se vuelve a montar y la pestaña
 *    salta a la primera. Quien guarda «Contacto» aterriza en «Dinero» y lo que
 *    ve es una pantalla que no hizo nada;
 *  • recargar pierde el sitio;
 *  • no se puede mandar un enlace a una sección concreta.
 *
 * Con la pestaña en la URL (`?tab=contact`) las tres cosas se arreglan solas, y
 * el botón de atrás del navegador hace lo que la gente espera.
 *
 * `preserveState` y `preserveScroll` porque cambiar de pestaña NO es navegar a
 * otra pantalla: lo que ya está escrito y sin guardar en otra pestaña tiene que
 * seguir ahí, y la página no debe saltar al principio.
 *
 * ## Lo que marca el punto rojo
 *
 * Una pestaña con errores de validación se marca. Sin eso, un error en un campo
 * que está en otra pestaña es un error invisible: la pantalla dice que algo
 * falló y no dice dónde, y quien guarda se queda mirando una sección correcta.
 *
 * ## Accesibilidad
 *
 * Roles `tablist`/`tab` de verdad, con `aria-selected` y `aria-controls`. Un
 * menú de pestañas hecho con `div`s es un control que parece un control y no lo
 * es para quien navega con teclado o con lector de pantalla.
 *
 * Y la tira se desplaza en horizontal en pantalla estrecha: un menú cuyas
 * entradas no se pueden alcanzar promete una navegación que no da.
 */
export function Tabs({
  tabs,
  active,
  param = 'tab',
  panelId = 'tab-panel',
}: {
  tabs: { id: string; label: string; invalid?: boolean }[]
  active: string
  /** El nombre del parámetro en la URL. */
  param?: string
  panelId?: string
}) {
  const ir = (id: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set(param, id)

    router.visit(url.toString(), {
      preserveState: true,
      preserveScroll: true,
      replace: true,
    })
  }

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-steel-100 px-4 sm:mx-0 sm:px-0"
    >
      {tabs.map((t) => {
        const seleccionada = t.id === active

        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={seleccionada}
            aria-controls={panelId}
            tabIndex={seleccionada ? 0 : -1}
            onClick={() => ir(t.id)}
            onKeyDown={(e) => {
              // Flechas entre pestañas: es lo que espera quien usa un tablist.
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') {
                return
              }

              e.preventDefault()
              const i = tabs.findIndex((x) => x.id === active)
              const salto = e.key === 'ArrowRight' ? 1 : -1
              const siguiente = tabs[(i + salto + tabs.length) % tabs.length]

              if (siguiente !== undefined) {
                ir(siguiente.id)
              }
            }}
            className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              seleccionada
                ? 'border-safety-500 text-carbon'
                : 'border-transparent text-steel-600 hover:border-steel-200 hover:text-carbon'
            }`}
          >
            {t.label}
            {t.invalid ? (
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full bg-danger-500"
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** El panel de la pestaña activa, atado al botón por `aria-labelledby`. */
export function TabPanel({
  active,
  id = 'tab-panel',
  children,
}: {
  active: string
  id?: string
  children: ReactNode
}) {
  return (
    <div role="tabpanel" id={id} aria-labelledby={`tab-${active}`} className="mt-6">
      {children}
    </div>
  )
}
