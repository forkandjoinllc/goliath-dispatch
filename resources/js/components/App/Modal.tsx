import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** El pie: los botones. Va aparte para que quede pegado abajo. */
  footer?: ReactNode
  /** Texto del botón de cerrar, del diccionario. */
  closeLabel: string
}

/**
 * Una ventana modal que no deja a nadie fuera.
 *
 * ## Lo que tiene que hacer una ventana, y no es solo taparlo todo
 *
 * Una caja con sombra encima de la pantalla se escribe en diez líneas, y
 * durante esas diez líneas quien navega con teclado se queda encerrado: el
 * tabulador sigue recorriendo la pantalla de debajo, que ya no se ve. Por eso
 * aquí hay cuatro cosas y no una:
 *
 * 1. **El foco entra.** Al abrirse, el foco va al primer campo. Sin esto, el
 *    tabulador empieza donde estaba antes —detrás de la ventana—.
 * 2. **El foco no sale.** El tabulador da la vuelta dentro de la ventana.
 * 3. **Escape cierra.** Es lo que todo el mundo prueba primero.
 * 4. **El foco vuelve.** Al cerrarse, vuelve al botón que la abrió, que es
 *    donde la persona cree que está.
 *
 * El fondo también cierra, pero solo el fondo: un `mousedown` que empieza
 * dentro y termina fuera —arrastrar para seleccionar texto— no cierra nada.
 * Con `onClick` sobre el fondo, seleccionar un texto del formulario y soltar
 * un pixel fuera tiraba lo escrito.
 *
 * ## Lo que NO hace
 *
 * No monta nada en `document.body` por su cuenta. Se pinta donde se la ponga,
 * con `position: fixed`, que es lo que la saca del flujo igual de bien y no
 * obliga a llevar la cuenta de un nodo fuera de React.
 */
export function Modal({ open, title, onClose, children, footer, closeLabel }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const devolverA = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (! open) return

    devolverA.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // El primer campo, y si no hay ninguno, la propia caja: algo tiene que
    // tener el foco o el lector de pantalla sigue leyendo lo de debajo.
    const primero = caja.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    )
    ;(primero ?? caja.current)?.focus()

    const enTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()

        return
      }

      if (e.key !== 'Tab') return

      const focos = caja.current?.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )

      if (focos === undefined || focos.length === 0) return

      const primerFoco = focos[0]
      const ultimo = focos[focos.length - 1]

      if (primerFoco === undefined || ultimo === undefined) return

      if (e.shiftKey && document.activeElement === primerFoco) {
        e.preventDefault()
        ultimo.focus()
      } else if (! e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primerFoco.focus()
      }
    }

    document.addEventListener('keydown', enTecla)
    // Sin esto la página de detrás se desplaza al rodar la rueda sobre el
    // fondo, y al cerrar la ventana el tablero está en otro sitio.
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', enTecla)
      document.body.style.overflow = antes
      devolverA.current?.focus()
    }
  }, [open, onClose])

  if (! open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-carbon/50 p-4 sm:items-center">
      {/*
        El fondo, DEBAJO de la caja en el orden del documento y con su propio
        `mousedown`. Es un botón de verdad y no un `div` con `onClick`: así
        tiene nombre para quien no ve la pantalla, aunque en la práctica se
        cierre antes con Escape. Va primero y sin z negativo —estuvo con
        `-z-10` y quedaba detrás del propio fondo del contenedor, donde no le
        llegaba ni un clic—.
      */}
      <button
        type="button"
        aria-label={closeLabel}
        tabIndex={-1}
        onMouseDown={onClose}
        className="absolute inset-0 cursor-default"
      />

      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative z-10 my-auto w-full max-w-lg rounded border border-steel-300 bg-white shadow-xl outline-none"
        onMouseDown={(e) => { e.stopPropagation() }}
      >
        <div className="flex items-center gap-3 border-b border-steel-200 px-5 py-3.5">
          <h2 className="text-sm font-bold uppercase tracking-[0.1em] text-navy-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="ml-auto rounded px-2 py-1 text-lg leading-none text-steel-600 transition hover:bg-steel-100 hover:text-carbon"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>

        {footer === undefined ? null : (
          <div className="flex flex-wrap justify-end gap-2 border-t border-steel-200 bg-navy-50 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
