/**
 * El avatar de una persona: sus iniciales sobre un color estable.
 *
 * No es un hueco esperando una foto. El producto no guarda fotos de conductor
 * —`equipment_media` guarda fotos de UNIDADES, que es otra cosa— y poner una
 * cara sacada de un banco de imágenes sería una persona que no existe puesta
 * donde va un compañero de trabajo.
 *
 * El color sale del identificador y no del nombre: dos conductores que se
 * llaman igual se distinguen, y el mismo conductor se pinta igual en las tres
 * columnas y mañana también. Los seis colores son de la paleta de marca, que
 * es lo que vigila `BrandColorsTest`.
 */
const COLORES = [
  'bg-navy-700',
  'bg-steel-600',
  'bg-safety-600',
  'bg-info-700',
  'bg-success-700',
  'bg-danger-600',
] as const

function color(id: string): string {
  let suma = 0
  for (let i = 0; i < id.length; i++) suma = (suma + id.charCodeAt(i)) % 4096

  return COLORES[suma % COLORES.length] ?? COLORES[0]
}

export function iniciales(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0)
  const b = lastName.trim().charAt(0)

  return `${a}${b}`.toUpperCase() || '—'
}

export function Avatar({
  id,
  firstName,
  lastName,
  size = 'md',
}: {
  id: string
  firstName: string
  lastName: string
  size?: 'sm' | 'md'
}) {
  const medida = size === 'sm' ? 'h-8 w-8 text-[11px]' : 'h-10 w-10 text-xs'

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-wide text-white ${color(id)} ${medida}`}
    >
      {iniciales(firstName, lastName)}
    </span>
  )
}
