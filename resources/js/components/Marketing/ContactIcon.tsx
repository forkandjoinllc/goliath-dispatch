/**
 * Los tres iconos del bloque de contacto: sitio, teléfono y correo.
 *
 * Dibujados a mano y no traídos de una librería, por lo mismo que los del menú
 * de la aplicación (ver App/NavIcon): son tres glifos, y cualquier paquete que
 * los traiga mete doscientos más en el bundle. Comparten viewBox y grosor de
 * trazo con aquellos para que el sitio entero se vea de la misma mano.
 *
 * `aria-hidden` en los tres: al lado va el texto —la dirección, el número, el
 * correo— y eso es lo que lee un lector de pantalla. Un icono anunciado además
 * de su etiqueta se oye dos veces.
 */
const PATHS = {
  location: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  phone:
    'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
  email: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM22 6l-10 7L2 6',
} satisfies Record<string, string>

export function ContactIcon({ name, className }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? 'mt-0.5 h-4 w-4 shrink-0'}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
