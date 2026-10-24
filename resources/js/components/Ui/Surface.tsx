import type { ReactNode } from 'react'

/**
 * La piel del panel: tarjetas, cabeceras y filas de datos.
 *
 * ## Qué se copió, y qué NO
 *
 * De Stripe se copia la FORMA: superficie blanca sobre un fondo casi neutro,
 * borde de un píxel en vez de sombra marcada, radio pequeño, mucho aire dentro
 * y poco entre secciones, rótulos pequeños y apagados, y el peso tipográfico
 * puesto en el dato y no en la etiqueta.
 *
 * De Stripe NO se copia el color. La paleta sigue siendo la de Goliath —navy,
 * naranja de seguridad, acero— porque es la misma que llevan el sitio público,
 * los correos al cliente y la página de rastreo que ve alguien que no es
 * usuario nuestro. Un panel morado y un correo naranja son dos empresas
 * distintas para quien los recibe. Y hay un guardián que lo sujeta:
 * `BrandColorsTest` rechaza cualquier clase de color fuera de las familias de
 * la marca.
 *
 * ## Por qué primitivos y no clases sueltas
 *
 * Las mismas nueve clases de Tailwind repetidas en treinta pantallas se
 * desincronizan en cuanto alguien cambia una. Aquí hay un sitio donde cambiar
 * el borde de las tarjetas.
 */

/** La caja blanca. Todo lo que no es una tabla a sangre vive dentro de una. */
export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode
  className?: string
  /** A falso para tablas, que pegan sus filas a los bordes. */
  padded?: boolean
}) {
  return (
    <section
      className={`overflow-hidden rounded-lg border border-steel-100 bg-white shadow-xs ${
        padded ? 'p-5 sm:p-6' : ''
      } ${className}`}
    >
      {children}
    </section>
  )
}

/**
 * El encabezado de una tarjeta: título, nota y acciones.
 *
 * El título va en peso medio y tamaño de texto, no en display grande: dentro de
 * una tarjeta compite con el dato, y el dato es lo que se ha venido a leer.
 */
export function CardHeader({
  title,
  note,
  actions,
}: {
  title: string
  note?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-carbon">{title}</h2>
        {note ? <p className="mt-1 max-w-2xl text-sm text-steel-600">{note}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  )
}

/**
 * Una rejilla de campos a dos columnas que se cae a una en pantalla estrecha.
 *
 * El hueco vertical es mayor que el horizontal a propósito: dos campos lado a
 * lado se leen como un par, y dos filas seguidas no.
 */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">{children}</div>
}

/** Un campo que ocupa las dos columnas. */
export function Wide({ children }: { children: ReactNode }) {
  return <div className="sm:col-span-2">{children}</div>
}

/**
 * Una nota de pie de sección: lo que hay que saber y no cabe en un `hint`.
 *
 * Fondo apagado y borde izquierdo, no un recuadro de aviso: esto no alarma, solo
 * explica. Los avisos de verdad llevan `warning` o `danger` y se ven distintos
 * justamente porque esto no lo hace.
 */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded border-l-2 border-steel-200 bg-steel-50 px-3 py-2 text-xs leading-relaxed text-steel-700">
      {children}
    </p>
  )
}
