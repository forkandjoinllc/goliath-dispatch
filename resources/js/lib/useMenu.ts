import { useEffect, useRef, useState } from 'react'

/**
 * Un desplegable que se comporta.
 *
 * Hace tres cosas que un `useState` suelto no hace: cierra al pulsar fuera,
 * cierra con Escape, y devuelve el foco al botón que lo abrió. Sin lo tercero,
 * quien navega con teclado acaba con el foco en el `<body>` y tiene que
 * empezar la página de nuevo.
 *
 * ## Por qué vive aquí y no dentro de la barra superior
 *
 * Porque nació allí, para sus tres menús, y su propio comentario avisaba de lo
 * que pasaría: «un cuarto menú escrito a mano acabaría haciendo dos de las
 * tres». El cuarto llegó con los filtros por estado del tablero, que están en
 * otro fichero. Copiarlo habría sido escribir el defecto que el comentario
 * anunciaba.
 */
export function useMenu() {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointer = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }

    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return { open, setOpen, container, trigger }
}
