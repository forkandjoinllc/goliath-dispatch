import { router } from '@inertiajs/react'

/**
 * Cambiar UN filtro sin perder los demás.
 *
 * ## El defecto que cierra
 *
 * Cada listado escribía su propia navegación, a mano, con la lista de filtros
 * que su autor tenía delante:
 *
 * ```tsx
 * router.get('/invoices', { search, status: e.target.value }, …)
 * ```
 *
 * `overdue` no está ahí. Se llega a él desde la tarjeta «Facturas vencidas» del
 * panel, la lista sale con siete filas y dos sumas de dinero calculadas sobre
 * ESE filtro — y en cuanto alguien teclea una letra en la búsqueda, el filtro
 * desaparece en silencio: la lista pasa a todas las facturas y los totales
 * saltan, sin nada en pantalla que lo explique. El paginador de esa misma
 * pantalla sí lo conservaba, así que se contradecía consigo misma.
 *
 * Lo mismo en Liquidaciones, que tira la búsqueda al tocar el estado, y en
 * Gastos, que arrastra un `load` que ningún control puede limpiar.
 *
 * ## La regla
 *
 * Se parte de TODOS los filtros que mandó el servidor y se aplica el cambio
 * encima. Lo que no se toca, no se pierde. Es lo que ya hacía el listado de
 * cargas, y el motivo está escrito en su propia pantalla:
 *
 * > quien aterriza aquí ve una lista corta y no sabe que está recortada — que
 * > es la otra forma de que un número y una lista se contradigan.
 *
 * Las claves vacías se quitan de la dirección: una URL con `?status=&search=`
 * se comparte mal y se lee peor.
 */
export function navegar(
  ruta: string,
  filtros: Record<string, string>,
  cambios: Record<string, string>,
): void {
  const siguiente: Record<string, string> = { ...filtros, ...cambios }

  for (const clave of Object.keys(siguiente)) {
    if (siguiente[clave] === '') {
      delete siguiente[clave]
    }
  }

  router.get(ruta, siguiente, { preserveState: true, preserveScroll: true, replace: true })
}

/** ¿Hay algún filtro puesto? Decide si se ofrece el botón de limpiar. */
export function hayFiltros(filtros: Record<string, string>): boolean {
  return Object.values(filtros).some((v) => v !== '')
}
