import { useId } from 'react'
import { INCHES_PER_FOOT } from '@/lib/measure'

/**
 * Una medida, escrita como se lee de una cinta: pies en una casilla y pulgadas
 * en otra.
 *
 * ## Por qué dos casillas y un solo número
 *
 * Porque nadie mide un remolque en pulgadas. Un permiso dice «13 pies 6», la
 * cinta dice lo mismo y quien da de alta la unidad tiene el papel delante: una
 * sola casilla en pulgadas obliga a multiplicar de cabeza, y quien multiplica
 * de cabeza escribe 162 en vez de 162 una de cada veinte veces.
 *
 * Hacia dentro sigue siendo UNA cifra en pulgadas, que es lo que compara la
 * evaluación de sobredimensión. La suma la hace el servidor, en
 * `App\Support\Equipment\Measure`, y por el cable viajan las dos casillas tal
 * como se escribieron. Las dos, y no la suma ya hecha, porque si esta pantalla
 * sumara, dejar las pulgadas en blanco después de escribir los pies las
 * rellenaría sola con un cero: la casilla se movería sin que nadie la tocara.
 *
 * ## Las pulgadas no pasan de once
 *
 * Doce pulgadas son un pie. Admitirlas dejaría dos maneras de escribir la misma
 * medida —«12 pies 14» y «13 pies 2»— y dos fichas idénticas que no se parecen.
 * El servidor lo rechaza igual; el tope de aquí es para que no haga falta.
 */
export function FeetInchesField({
  label,
  hint,
  error,
  feet,
  inches,
  onChange,
  feetLabel,
  inchesLabel,
}: {
  label: string
  hint?: string
  error?: string
  feet: number | null
  inches: number | null
  /** Las dos casillas tal como están, sin sumar. */
  onChange: (v: { feet: number | null; inches: number | null }) => void
  feetLabel: string
  inchesLabel: string
}) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-sm font-medium text-carbon">
        {label}
      </span>
      <div className="flex items-center gap-2" role="group" aria-labelledby={id}>
        <Casilla
          aria-label={`${label} — ${feetLabel}`}
          value={feet}
          max={200}
          invalid={error !== undefined}
          onChange={(v) => { onChange({ feet: v, inches }) }}
        />
        <span aria-hidden="true" className="text-xs text-steel-600">
          {feetLabel}
        </span>
        <Casilla
          aria-label={`${label} — ${inchesLabel}`}
          value={inches}
          max={INCHES_PER_FOOT - 1}
          invalid={error !== undefined}
          onChange={(v) => { onChange({ feet, inches: v }) }}
        />
        <span aria-hidden="true" className="text-xs text-steel-600">
          {inchesLabel}
        </span>
      </div>
      {hint !== undefined && error === undefined ? (
        <p className="text-xs text-steel-600">{hint}</p>
      ) : null}
      {error !== undefined ? (
        <p role="alert" className="text-xs font-medium text-safety-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function Casilla({
  value,
  max,
  invalid,
  onChange,
  ...props
}: {
  value: number | null
  max: number
  invalid: boolean
  onChange: (v: number | null) => void
  'aria-label': string
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      value={value ?? ''}
      aria-invalid={invalid ? true : undefined}
      onChange={(e) => {
        onChange(e.target.value === '' ? null : Number(e.target.value))
      }}
      className="w-20 rounded border border-steel-300 bg-white px-3 py-2 text-sm tabular-nums text-carbon outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200 aria-[invalid=true]:border-safety-600"
      {...props}
    />
  )
}
