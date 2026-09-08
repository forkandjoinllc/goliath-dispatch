import type { Locale } from '@/types'

/** Una entrada de menú, ya filtrada por permisos EN EL SERVIDOR. */
export interface NavItem {
  href: string
  labelKey: string
  /** Falso mientras la pantalla no exista: se pinta apagada, no se enlaza. */
  ready: boolean
}

export interface NavGroup {
  key: string
  labelKey: string
  items: NavItem[]
}

export interface ShellActor {
  name: string
  email: string
  role: string | null
  isPlatformSuperAdmin: boolean
  mfaRequired: boolean
  mfaSatisfied: boolean
  impersonating: boolean
}

export interface ShellTenant {
  id: string
  name: string
  slug: string
  status: string
}

export interface ShellMembership {
  id: string
  name: string
  role: string
}

/**
 * El reloj de quien mira. `zone` es la abreviatura de HOY —EDT en julio, EST en
 * enero— y por eso la calcula el servidor y no el navegador: el del navegador
 * puede estar en otro huso que el elegido.
 */
export interface ShellClock {
  timezone: string
  zone: string
  options: string[]
}

export interface Shell {
  actor: ShellActor
  clock: ShellClock
  tenant: ShellTenant | null
  memberships: ShellMembership[]
  nav: NavGroup[]
  /** Avisos sin leer de ESTA persona en ESTA empresa. Sostiene la campana. */
  unreadNotifications: number
  supportEmail: string | null
}

/** Props que trae toda página autenticada. `shell` es null en el sitio público. */
export interface AppSharedProps {
  shell: Shell | null
  locale: Locale
}

/** Un eslabón de las migas. El último no lleva href: es la página actual. */
export interface Crumb {
  label: string
  href?: string
}
