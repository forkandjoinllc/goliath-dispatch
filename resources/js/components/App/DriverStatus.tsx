import { useI18n } from '@/lib/i18n'

/**
 * Los seis estados de un conductor, con sus palabras y sus colores.
 *
 * ## Por qué un componente y no un mapa en cada pantalla
 *
 * Porque había tres: la lista de conductores tenía sus tonos y sus fichas, el
 * tablero de despacho tenía sus puntos, y la ficha iba a tener los suyos. Tres
 * copias de la misma tabla aguantan mientras nadie añada un estado; el día que
 * se añaden «en espera» y «dado de baja», las tres copias son tres sitios donde
 * falta uno, y el que se quede corto pinta gris lo que debería pintar rojo.
 *
 * Las palabras salen de `drivers.status.*`, que es el diccionario de la ficha
 * del conductor. Un segundo juego de nombres para los mismos seis estados acaba
 * diciendo otra cosa.
 *
 * El orden es el de la jornada, no el alfabético: lo que trabaja primero, lo
 * que no trabaja después.
 */
export const ESTADOS_DE_CONDUCTOR = [
  'available',
  'on_load',
  'off_duty',
  'inactive',
  'on_hold',
  'terminated',
] as const

/** Fondo y borde de la pastilla. */
const TONO: Record<string, string> = {
  available: 'bg-success-50 text-success-700 ring-success-500/40',
  on_load: 'bg-navy-100 text-navy-800 ring-navy-500/30',
  off_duty: 'bg-steel-100 text-steel-800 ring-steel-300',
  inactive: 'bg-steel-100 text-steel-600 ring-steel-300',
  // En espera es ámbar: es temporal y hay que resolverlo. La baja es roja y no
  // gris — gris se lee como «no está hoy», y esto es «no vuelve».
  on_hold: 'bg-warning-50 text-warning-700 ring-warning-500/40',
  terminated: 'bg-danger-50 text-danger-700 ring-danger-500/40',
}

/** El punto de color, para donde no cabe la pastilla. */
const PUNTO: Record<string, string> = {
  available: 'bg-success-500',
  on_load: 'bg-info-500',
  off_duty: 'bg-steel-400',
  inactive: 'bg-steel-400',
  on_hold: 'bg-warning-500',
  terminated: 'bg-danger-500',
}

export function DriverStatusBadge({ value }: { value: string | null }) {
  const { t } = useI18n()

  if (value === null || value === '') return null

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        TONO[value] ?? TONO.inactive
      }`}
    >
      {t(`drivers.status.${value}`)}
    </span>
  )
}

export function DriverStatusDot({ value }: { value: string | null }) {
  const { t } = useI18n()

  return (
    <span className="inline-flex items-center gap-1.5 text-steel-700">
      <span
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 rounded-full ${
          value === null ? 'bg-steel-400' : (PUNTO[value] ?? 'bg-steel-400')
        }`}
      />
      {value === null ? '—' : t(`drivers.status.${value}`)}
    </span>
  )
}
