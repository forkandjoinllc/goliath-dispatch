import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useId } from 'react'

function Wrapper({
  label,
  error,
  hint,
  required,
  htmlFor,
  children,
}: {
  label: string
  error?: string
  hint?: string
  required?: boolean
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-carbon">
        {label}
        {required ? (
          <span className="ml-1 text-safety-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-steel-600">{hint}</p> : null}
      {/* role="alert" para que un lector de pantalla anuncie el error al
          aparecer, sin que el usuario tenga que volver al campo. */}
      {error ? (
        <p role="alert" className="text-xs font-medium text-safety-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

const INPUT_CLASS =
  'rounded border border-steel-300 bg-white px-3 py-2 text-sm text-carbon outline-none transition placeholder:text-steel-500 focus:border-navy-500 focus:ring-2 focus:ring-navy-200 aria-[invalid=true]:border-safety-600'

export function TextField({
  label,
  error,
  hint,
  ...props
}: { label: string; error?: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  const errorId = `${id}-error`

  return (
    <Wrapper label={label} error={error} hint={hint} required={props.required} htmlFor={id}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={INPUT_CLASS}
        {...props}
      />
    </Wrapper>
  )
}

export function TextArea({
  label,
  error,
  hint,
  ...props
}: { label: string; error?: string; hint?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()

  return (
    <Wrapper label={label} error={error} hint={hint} required={props.required} htmlFor={id}>
      <textarea id={id} rows={5} aria-invalid={error ? true : undefined} className={INPUT_CLASS} {...props} />
    </Wrapper>
  )
}

export function CheckboxField({
  label,
  error,
  ...props
}: { label: ReactNode; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          className="mt-1 size-4 rounded border-steel-400 text-navy-700 focus:ring-navy-300"
          {...props}
        />
        <label htmlFor={id} className="text-sm text-carbon">
          {label}
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-safety-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Un desplegable. Las opciones vienen como pares para que la etiqueta pueda
 * traducirse y el valor siga siendo el que espera el servidor — nunca se manda
 * al servidor lo que está escrito en pantalla.
 */
export function SelectField({
  label,
  error,
  hint,
  options,
  ...props
}: {
  label: string
  error?: string
  hint?: string
  options: { value: string; label: string }[]
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()
  const errorId = `${id}-error`

  return (
    <Wrapper label={label} error={error} hint={hint} required={props.required} htmlFor={id}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={INPUT_CLASS}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Wrapper>
  )
}
