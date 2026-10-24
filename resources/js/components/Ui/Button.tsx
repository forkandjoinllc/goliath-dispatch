import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Los botones del panel.
 *
 * Tres pesos y no más: el que hace la acción de la pantalla, el que acompaña, y
 * el que destruye. Cuando hay cuatro, el tercero y el cuarto se eligen al azar
 * y la pantalla deja de decir qué es lo importante.
 *
 * El naranja de seguridad es el primario porque es el color de la marca, pero
 * lleva texto blanco sobre `safety-600` y no sobre el `safety-500` canónico:
 * ese mide ~3.1:1 contra blanco y no llega para texto pequeño. Ver docs/brand.md.
 */
const PESOS = {
  primary:
    'bg-safety-600 text-white shadow-xs hover:bg-safety-700 focus-visible:outline-safety-600',
  secondary:
    'border border-steel-200 bg-white text-carbon shadow-xs hover:bg-steel-50 focus-visible:outline-navy-500',
  danger:
    'border border-danger-300 bg-white text-danger-700 shadow-xs hover:bg-danger-50 focus-visible:outline-danger-600',
  ghost: 'text-steel-700 hover:bg-steel-50 hover:text-carbon focus-visible:outline-navy-500',
} as const

export function Button({
  weight = 'secondary',
  children,
  className = '',
  ...props
}: {
  weight?: keyof typeof PESOS
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${PESOS[weight]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * La barra de acciones al pie de una tarjeta de formulario.
 *
 * Separada por una línea y con el fondo apagado, como hace Stripe: deja claro
 * dónde acaba lo que se edita y empieza lo que se pulsa. Y los botones van a la
 * DERECHA, que es donde acaba de leer quien ha rellenado el formulario.
 */
export function FormActions({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="-mx-5 -mb-5 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-steel-100 bg-steel-50 px-5 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
      <p className="text-xs text-steel-600">{note ?? ''}</p>
      <div className="flex gap-2">{children}</div>
    </div>
  )
}
