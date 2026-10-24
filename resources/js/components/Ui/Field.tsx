import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

/**
 * Los campos del panel.
 *
 * ## El error desplaza a la pista, no se suma
 *
 * Cuando hay error, la pista desaparece. Las dos juntas obligan a leer dos
 * líneas pequeñas para averiguar cuál de las dos dice qué hacer ahora, y la que
 * importa es siempre la del error.
 *
 * ## `aria-invalid` y `aria-describedby` de verdad
 *
 * Un mensaje rojo debajo del campo es el error para quien lo ve. Para quien usa
 * un lector de pantalla no existe si el campo no lo apunta. Son dos atributos.
 */
const ENTRADA =
  'w-full rounded-md border border-steel-200 bg-white px-3 py-2 text-sm text-carbon shadow-xs outline-none transition placeholder:text-steel-400 focus:border-navy-500 focus:ring-2 focus:ring-navy-100 disabled:cursor-not-allowed disabled:bg-steel-50 disabled:text-steel-600'

const ENTRADA_MAL = 'border-danger-500 focus:border-danger-500 focus:ring-danger-100'

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  error?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-carbon">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-steel-600">{hint}</p>
      ) : null}
    </div>
  )
}

export function TextInput({
  label,
  hint,
  error,
  ...props
}: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()

  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${ENTRADA} ${error ? ENTRADA_MAL : ''}`}
        {...props}
      />
    </Field>
  )
}

export function SelectInput({
  label,
  hint,
  error,
  children,
  ...props
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()

  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        className={`${ENTRADA} ${error ? ENTRADA_MAL : ''}`}
        {...props}
      >
        {children}
      </select>
    </Field>
  )
}

/**
 * Una casilla con su rótulo y su explicación.
 *
 * El rótulo es parte del `label`, así que pulsar el texto marca la casilla. Una
 * casilla con el texto al lado pero fuera del `label` es un objetivo de cinco
 * milímetros, y eso en una tableta no se acierta.
 */
export function Checkbox({
  label,
  hint,
  error,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  hint?: string
  error?: string
  checked: boolean
  onChange: (valor: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-steel-300 text-safety-600 focus:ring-2 focus:ring-navy-100 disabled:cursor-not-allowed"
        />
        <span className="min-w-0">
          <span className="block text-sm text-carbon">{label}</span>
          {hint ? <span className="mt-0.5 block text-xs text-steel-600">{hint}</span> : null}
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Un dato que no se edita.
 *
 * Existe para que un valor de solo lectura NO se pinte como un campo
 * desactivado. Un campo gris invita a pulsarlo y a preguntarse por qué no
 * responde; esto se lee como lo que es: un dato.
 */
export function ReadOnly({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-steel-600">{label}</span>
      <span className="font-mono text-sm text-carbon">{value}</span>
      {hint ? <span className="text-xs text-steel-600">{hint}</span> : null}
    </div>
  )
}
