/**
 * Pies y pulgadas por fuera, pulgadas por dentro.
 *
 * El servidor guarda UNA cifra en pulgadas —ver `App\Support\Equipment\Measure`,
 * que explica por qué no son dos columnas— y esta pantalla es la que la parte
 * para enseñarla y para rellenar el formulario.
 *
 * La constante está escrita dos veces, aquí y en PHP, porque el navegador no
 * puede leer una constante de PHP. El guardián `MeasureUnitsTest` comprueba que
 * las dos digan doce, y que el formulario no admita una duodécima pulgada.
 */
export const INCHES_PER_FOOT = 12

export interface FeetInches {
  feet: number | null
  inches: number | null
}

/** De una cifra en pulgadas a pies y pulgadas. Vacío si no hay medida. */
export function splitInches(total: number | null | undefined): FeetInches {
  if (total === null || total === undefined) return { feet: null, inches: null }

  return {
    feet: Math.floor(total / INCHES_PER_FOOT),
    inches: total % INCHES_PER_FOOT,
  }
}

/**
 * Cómo se escribe una medida para leerla.
 *
 * Sin pies cuando no llega al pie —«8″» y no «0′ 8″»—, porque un cero delante
 * se lee como un dato y no lo es. Las comillas de pie y pulgada no se traducen:
 * son las mismas en un permiso de Texas y en uno de Sonora.
 */
export function formatInches(total: number | null | undefined): string | null {
  if (total === null || total === undefined) return null

  const { feet, inches } = splitInches(total)

  if (feet === 0) return `${String(inches)}″`

  return inches === 0 ? `${String(feet)}′` : `${String(feet)}′ ${String(inches)}″`
}
