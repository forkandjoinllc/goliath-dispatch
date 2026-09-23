/**
 * Los dibujos del mapa, en un solo sitio.
 *
 * Los usan las dos mitades —el mapa con teselas de Google y el de fondo liso—
 * porque un PIN de recogida tiene que ser el MISMO dibujo con clave y sin ella.
 * Si cada mitad dibujara el suyo, la instalación sin clave enseñaría un mapa
 * que no se parece al de producción y nadie lo notaría hasta llegar allí.
 */

/** La gota del PIN, con la punta abajo en (0,0). */
export const GOTA =
  'M0 0 C0 0 -9 -11.5 -9 -17.5 A9 9 0 1 1 9 -17.5 C9 -11.5 0 0 0 0 Z'

/**
 * Los colores salen de los tokens de marca, leídos del CSS.
 *
 * Leídos y no copiados: el día que la marca cambie el naranja, el PIN cambia
 * con ella. Google necesita un color concreto —no acepta `var(...)` en el
 * icono de un marcador—, así que se resuelve aquí una vez.
 *
 * El valor de reserva es el mismo token escrito a mano, y solo se usa si el
 * CSS no ha cargado todavía. Es la única copia, y está aquí para que un mapa
 * sin colorear no sea un mapa vacío.
 */
function token(nombre: string, reserva: string): string {
  if (typeof window === 'undefined') return reserva

  const valor = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()

  return valor === '' ? reserva : valor
}

/** Recogida en naranja de marca, entrega en azul marino. No se confunden. */
export function colorParada(tipo: string): string {
  return tipo === 'pickup'
    ? token('--color-safety-600', '#C24602')
    : token('--color-navy-700', '#062B5C')
}

/** El color del punto de un camión. */
export function colorUnidad(): string {
  return token('--color-success-700', '#15803D')
}

/**
 * La silueta del conjunto, según el remolque que lleve.
 *
 * Un mapa con treinta puntos se lee por el dibujo antes que por el texto, y lo
 * que distingue a un conjunto de otro en la calle es el remolque. Los códigos
 * son los de `equipment_types.code`; el que no esté en la lista cae en el
 * genérico, que es un remolque de caja — y no un interrogante, porque el
 * conjunto existe aunque no sepamos de qué tipo es.
 */
export const SILUETAS: Record<string, string> = {
  // Plataforma: una barra plana.
  flatbed: 'M-16 2 h32 v3 h-32 z M-16 -1 h6 v-6 h5 v6 h21 v3 h-32 z',
  // Plataforma escalonada: la barra baja a la mitad.
  step_deck: 'M-16 -1 h6 v-6 h5 v6 h7 v3 h14 v3 h-32 z',
  // Cuello de cisne bajo y cama baja: un pozo entre los dos extremos.
  double_drop: 'M-16 -1 h6 v-6 h5 v6 h3 v4 h10 v-4 h8 v3 h-6 v4 h-16 v-4 h-10 z',
  lowboy: 'M-16 -1 h6 v-6 h5 v6 h3 v4 h10 v-4 h8 v3 h-6 v4 h-16 v-4 h-10 z',
  // Cuello desmontable: el pozo, y el cuello marcado delante.
  rgn: 'M-16 -1 h6 v-6 h5 v6 h2 v-2 h3 v6 h8 v-4 h8 v3 h-6 v4 h-16 v-4 h-10 z',
  // Conestoga: el techo curvo.
  conestoga: 'M-16 -1 h6 v-6 h5 v6 h1 a10 10 0 0 1 20 0 v3 h-32 z',
  // Caja seca: la caja alta.
  dry_van: 'M-16 -1 h6 v-6 h5 v6 h1 v-7 h20 v10 h-32 z',
}

/** El conjunto sin tipo conocido: un remolque de caja, que es lo más común. */
export const SILUETA_GENERICA = SILUETAS.dry_van ?? ''

export function siluetaDe(tipo: string | null): string {
  return (tipo === null ? undefined : SILUETAS[tipo]) ?? SILUETA_GENERICA
}
