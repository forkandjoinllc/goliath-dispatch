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

export interface Shell {
  actor: ShellActor
  tenant: ShellTenant | null
  memberships: ShellMembership[]
  nav: NavGroup[]
  /** Avisos sin leer de ESTA persona en ESTA empresa. Sostiene la campana. */
  unreadNotifications: number
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
