/**
 * Los iconos del menú, dibujados a mano.
 *
 * Sin librería de iconos a propósito: son veinticuatro glifos, y cualquier
 * paquete que los traiga mete doscientos más en el bundle. Todos comparten
 * viewBox y grosor de trazo para que la columna quede alineada.
 *
 * `aria-hidden` en todos: la etiqueta de texto va al lado y ya la lee el lector
 * de pantalla. Un icono anunciado además de su etiqueta se oye dos veces.
 */
const PATHS: Record<string, string> = {
  dashboard: 'M3 12h7V3H3v9Zm0 9h7v-6H3v6Zm11 0h7V12h-7v9Zm0-18v6h7V3h-7Z',
  loads: 'M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6ZM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  customers: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75',
  tracking: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  permits: 'M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4Zm-1.5 13-3-3 1.4-1.4 1.6 1.6 4.6-4.6L16.5 9l-6 6Z',
  messages: 'M21 12a8 8 0 0 1-8 8H7l-4 3v-4.6A8 8 0 0 1 13 4a8 8 0 0 1 8 8Z',
  carriers: 'M4 17V8h9v9H4Zm9-6h4l3 3v3h-7v-6ZM7 20a1.8 1.8 0 1 0 0-3.6A1.8 1.8 0 0 0 7 20Zm10 0a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM7 4h10',
  onboarding: 'M9 11l3 3 6-6M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8',
  drivers: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 10a8 8 0 0 1 16 0',
  equipment: 'M4 16V9h12v7H4Zm12-4h3l2 2v2h-5v-4ZM6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 6h8',
  documents: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h6',
  signatures: 'M3 18c3 0 4-9 7-9s3 6 5 6 2-3 4-3M3 21h18',
  invoices: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6M9 16h3',
  settlements: 'M12 2v20M17 6H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6',
  expenses: 'M20 8H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1Zm-1 0v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8M9 12h6',
  payments: 'M2 8h20M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Zm4 9h4',
  factoring: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  assignments: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m-6 7h6m-6 4h4',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 2h-4l-.4 2.6c-.7.3-1.4.7-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  audit: 'M12 8v5l3 2M12 21a9 9 0 1 0-9-9M3 12l2.5 2.5L8 12',
  leads: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3.5-7Z',
  tenants: 'M3 21V7l7-4 7 4v14M3 21h18M8 21v-5h4v5M7 10h1m3 0h1m-5 3h1m3 0h1M17 12h4v9',
  plans: 'M3 9h18M3 9V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3M3 9v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9M8 14h4',
  platformHealth: 'M3 12h4l2-6 4 12 2-6h6',
}

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const d = PATHS[name] ?? PATHS.dashboard!

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? 'h-[18px] w-[18px] shrink-0'}
    >
      <path d={d} />
    </svg>
  )
}
