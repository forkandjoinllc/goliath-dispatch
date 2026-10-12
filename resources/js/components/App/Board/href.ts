/** Lo que hay que conservar al moverse por el tablero. */
export interface FiltrosDelTablero {
  tab: string
  period: string
  from?: string
  to?: string
  carrier?: string
  /** Estados de carga elegidos. Vacío quiere decir «todos». */
  status?: string[]
  /** Estados de conductor elegidos. Nunca vacío: ver `Support\Board\Statuses`. */
  driverStatus?: string[]
}

/**
 * La dirección del tablero con lo que haya que conservar.
 *
 * La pestaña y los cuatro filtros viajan SIEMPRE. Sin la pestaña, abrir una
 * carga desde «asignadas» devolvía el tablero a «sin asignar»; sin el periodo y
 * el transportista pasa lo mismo con más ruido: se abre una carga y al cerrar
 * el panel la lista de debajo es otra, sin que nadie haya tocado un filtro. Con
 * los dos filtros por estado el mismo defecto tiene dos formas nuevas.
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

  // Los estados, separados por comas. Una lista vacía NO se manda: en cargas
  // vacío ya quiere decir «todos», y en conductores el servidor devuelve su
  // reparto por defecto, que es justo lo que queremos cuando nadie ha elegido.
  if (filtros.status !== undefined && filtros.status.length > 0) {
    q.set('status', filtros.status.join(','))
  }

  if (filtros.driverStatus !== undefined && filtros.driverStatus.length > 0) {
    q.set('driverStatus', filtros.driverStatus.join(','))
  }

  if (params.load !== undefined) q.set('load', params.load)
  if (params.driver !== undefined) q.set('driver', params.driver)

  return `/home?${q.toString()}`
}
