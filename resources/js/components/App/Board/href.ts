/**
 * La dirección del tablero con lo que haya que conservar.
 *
 * La pestaña viaja SIEMPRE. Sin ella, abrir una carga desde la pestaña de las
 * asignadas devolvía el tablero a «sin asignar», y al cerrar el panel la lista
 * de debajo era otra: se había perdido el sitio sin tocar nada.
 *
 * Una sola función y no una plantilla escrita en cada enlace, porque son seis
 * sitios —la tarjeta, el conductor, la cronología, los dos cierres y la carga
 * en curso— y el séptimo es el que se olvida.
 */
export function boardHref(tab: string, params: { load?: string; driver?: string } = {}): string {
  const q = new URLSearchParams({ tab })

  if (params.load !== undefined) q.set('load', params.load)
  if (params.driver !== undefined) q.set('driver', params.driver)

  return `/home?${q.toString()}`
}
