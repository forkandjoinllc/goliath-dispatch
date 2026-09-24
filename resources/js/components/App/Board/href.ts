/** Lo que hay que conservar al moverse por el tablero. */
export interface FiltrosDelTablero {
  tab: string
  period: string
  from?: string
  to?: string
  carrier?: string
}

/**
 * La dirección del tablero con lo que haya que conservar.
 *
 * La pestaña y los dos filtros viajan SIEMPRE. Sin la pestaña, abrir una carga
 * desde «asignadas» devolvía el tablero a «sin asignar»; sin el periodo y el
 * transportista pasa lo mismo con más ruido: se abre una carga y al cerrar el
 * panel la lista de debajo es otra, sin que nadie haya tocado un filtro.
 *
 * Una sola función y no una plantilla escrita en cada enlace, porque son ocho
 * sitios —la tarjeta, el conductor, las pestañas, la cronología, los dos
 * cierres y la carga en curso— y el noveno es el que se olvida.
 */
export function boardHref(
  filtros: FiltrosDelTablero,
  params: { load?: string; driver?: string } = {},
): string {
  const q = new URLSearchParams({ tab: filtros.tab, period: filtros.period })

  // Las dos fechas solo con el periodo a medida: en cualquier otro las calcula
  // el servidor, y mandarlas invitaría a que alguien se creyera que mandan.
  if (filtros.period === 'custom') {
    if (filtros.from !== undefined) q.set('from', filtros.from)
    if (filtros.to !== undefined) q.set('to', filtros.to)
  }

  if (filtros.carrier !== undefined) q.set('carrier', filtros.carrier)
  if (params.load !== undefined) q.set('load', params.load)
  if (params.driver !== undefined) q.set('driver', params.driver)

  return `/home?${q.toString()}`
}
