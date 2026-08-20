import type { ComponentType } from 'react'

type PageComponent = ComponentType<Record<string, unknown>>
type PageModule = { default: PageComponent }
type PageGlob = Record<string, () => Promise<unknown>>

/**
 * Resuelve el componente de una página por su nombre de Inertia.
 *
 * Se escribe a mano en vez de usar `resolvePageComponent` de laravel-vite-plugin
 * porque el tipo que devuelve ese helper (una promesa de promesa) no encaja con
 * el `ComponentResolver` de Inertia y obliga a un cast que apaga la comprobación
 * de tipos justo en el punto donde importa: si una página no existe, quiero
 * enterarme por un error claro, no por una pantalla en blanco.
 */
export function resolvePage(pages: PageGlob) {
  return async (name: string): Promise<PageComponent> => {
    const path = `./pages/${name}.tsx`
    const loader = pages[path]

    if (!loader) {
      const available = Object.keys(pages)
        .map((p) => p.replace('./pages/', '').replace('.tsx', ''))
        .sort()
      throw new Error(
        `Página de Inertia "${name}" no encontrada en ${path}.\nDisponibles: ${available.join(', ')}`,
      )
    }

    // Se devuelve el componente, no el módulo: el ComponentResolver de Inertia
    // acepta `Promise<Component>` o `{ default: Component }`, pero no una
    // promesa del módulo.
    return ((await loader()) as PageModule).default
  }
}
