import { useMemo, useRef, useState } from 'react'

export interface Choice {
  id: string
  name: string
  /** Texto secundario, para desempatar homónimos. */
  hint?: string | null
}

interface Props {
  label: string
  choices: Choice[]
  onPick: (id: string) => void
  placeholder?: string
  hint?: string
  emptyText: string
  /** Qué dice el botón que deshace la elección. Del diccionario, no fijo aquí. */
  changeText?: string
  /** Ids que ya están elegidos: salen fuera de la lista. */
  exclude?: string[]
  disabled?: boolean
  /**
   * Lo elegido, cuando el campo es de UNO.
   *
   * Con esto el componente sirve también para un campo de un solo valor —el
   * transportista de un camión— y no solo para ir añadiendo a una lista: en
   * vez del buscador enseña lo elegido, con un botón para cambiarlo. Sin esto
   * había que escribir dos veces el mismo combobox, y el segundo acabaría
   * comportándose distinto del primero.
   */
  selected?: Choice | null
  onClear?: () => void
  required?: boolean
  error?: string
}

/**
 * Un desplegable que se busca escribiendo.
 *
 * Existe porque una lista de casillas deja de servir alrededor de los treinta
 * elementos y se vuelve hostil a los doscientos: quien da de alta un conductor
 * de un transportista concreto no quiere recorrer la lista entera, quiere
 * escribir tres letras.
 *
 * Elige de UNO EN UNO a propósito. Quien lo usa decide luego si añade otro; el
 * componente no sabe ni le importa si el padre admite varios.
 *
 * Sin librería: es un `input` con una lista debajo. Añadir un combobox de
 * terceros por esto pesaría más que la pantalla entera.
 */
export function SearchableSelect({
  label,
  choices,
  onPick,
  placeholder,
  hint,
  emptyText,
  changeText = '',
  exclude = [],
  disabled = false,
  selected = null,
  onClear,
  required = false,
  error,
}: Props) {
  const [query, setQuery] = useState('')
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef<HTMLDivElement>(null)

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase()
    const libres = choices.filter((c) => ! exclude.includes(c.id))

    if (q === '') return libres.slice(0, 50)

    return libres
      .filter((c) => c.name.toLowerCase().includes(q) || (c.hint ?? '').toLowerCase().includes(q))
      .slice(0, 50)
  }, [choices, query, exclude])

  const elegir = (id: string) => {
    onPick(id)
    setQuery('')
    setAbierto(false)
  }

  return (
    <div
      ref={contenedor}
      className="flex flex-col gap-1"
      // Se cierra al salir del componente entero, no al perder el foco el
      // input: si no, el clic sobre una opción cerraría la lista antes de
      // registrarse y no se podría elegir nada con el ratón.
      onBlur={(e) => {
        if (! contenedor.current?.contains(e.relatedTarget as Node | null)) setAbierto(false)
      }}
    >
      <span className="text-sm font-medium text-carbon">
        {label}
        {required ? <span className="ml-0.5 text-danger-600">*</span> : null}
      </span>

      {selected !== null ? (
        <div className="flex items-center justify-between gap-3 rounded border border-steel-300 bg-white px-3 py-2">
          <span className="text-sm text-carbon">
            {selected.name}
            {selected.hint ? <span className="block text-xs text-steel-600">{selected.hint}</span> : null}
          </span>
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              disabled={disabled}
              className="shrink-0 text-xs font-medium text-navy-700 underline transition hover:text-navy-900"
            >
              {changeText}
            </button>
          ) : null}
        </div>
      ) : (
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={abierto}
          aria-autocomplete="list"
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onFocus={() => setAbierto(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setAbierto(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAbierto(false)
            // Enter elige la única opción que queda. Con dos o más no adivina:
            // adivinar aquí es asignarle el transportista equivocado a alguien.
            if (e.key === 'Enter' && visibles.length === 1) {
              e.preventDefault()
              elegir(visibles[0]!.id)
            }
          }}
          className="w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-steel-500 focus:border-navy-500 focus:ring-2 focus:ring-navy-200 disabled:bg-steel-50"
        />

        {abierto ? (
          <ul
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded border border-steel-300 bg-white shadow-lg"
          >
            {visibles.length === 0 ? (
              <li className="px-3 py-2 text-sm text-steel-600">{emptyText}</li>
            ) : null}

            {visibles.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => elegir(c.id)}
                  className="block w-full px-3 py-2 text-left text-sm transition hover:bg-navy-50"
                >
                  {c.name}
                  {c.hint ? <span className="block text-xs text-steel-600">{c.hint}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      )}

      {hint ? <p className="text-xs text-steel-600">{hint}</p> : null}
      {error ? <p role="alert" className="text-xs text-danger-700">{error}</p> : null}
    </div>
  )
}
