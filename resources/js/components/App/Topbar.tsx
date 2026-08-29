import { Link, router, usePage } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import type { SharedProps } from '@/types'
import type { Crumb, Shell } from '@/types/app'

/**
 * La barra superior: migas, empresa activa, idioma y cuenta.
 *
 * Los tres menús desplegables comparten `useMenu`, que hace tres cosas que un
 * `useState` suelto no hace: cierra al pulsar fuera, cierra con Escape, y
 * devuelve el foco al botón que lo abrió. Sin lo tercero, quien navega con
 * teclado acaba con el foco en el <body> y tiene que empezar la página de nuevo.
 */
function useMenu() {
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

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true" className="h-3.5 w-3.5">
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const MENU_PANEL =
  'absolute right-0 z-30 mt-2 min-w-56 rounded border border-steel-200 bg-white py-1 shadow-lg'

function TenantSwitcher({ shell }: { shell: Shell }) {
  const { t } = useI18n()
  const { open, setOpen, container, trigger } = useMenu()

  const label = shell.tenant?.name ?? (shell.actor.isPlatformSuperAdmin
    ? t('nav.shell.platformScope')
    : t('nav.shell.noCompany'))

  // Con una sola empresa no hay nada que elegir: se enseña el nombre y ya.
  if (shell.memberships.length <= 1) {
    return (
      <span className="hidden items-center gap-2 rounded border border-steel-200 px-3 py-1.5 text-sm text-carbon sm:flex">
        <span className="h-2 w-2 shrink-0 rounded-full bg-safety-500" aria-hidden="true" />
        {label}
      </span>
    )
  }

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('nav.shell.switchTenant')}
        className="flex items-center gap-2 rounded border border-steel-200 px-3 py-1.5 text-sm text-carbon transition hover:bg-navy-50"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-safety-500" aria-hidden="true" />
        <span className="max-w-40 truncate">{label}</span>
        <Chevron />
      </button>

      {open ? (
        <div role="menu" className={MENU_PANEL}>
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-steel-500">
            {t('nav.shell.switchTenant')}
          </p>
          {shell.memberships.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                // El servidor vuelve a comprobar la pertenencia antes de
                // cambiar nada. Este menú es comodidad, no autorización.
                router.post('/switch-tenant', { tenant_id: m.id }, { preserveScroll: true })
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-navy-50 ${
                m.id === shell.tenant?.id ? 'font-semibold text-navy-700' : 'text-carbon'
              }`}
            >
              <span className="flex-1 truncate">{m.name}</span>
              <span className="shrink-0 text-xs text-steel-500">{t(`nav.roles.${m.role}`)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function LocaleMenu() {
  const { t, locale } = useI18n()
  const { locales } = usePage<SharedProps>().props
  const { open, setOpen, container, trigger } = useMenu()

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('nav.userMenu.language')}
        className="flex items-center gap-1.5 rounded border border-steel-200 px-2.5 py-1.5 text-sm font-medium uppercase text-carbon transition hover:bg-navy-50"
      >
        {locale}
        <Chevron />
      </button>

      {open ? (
        <div role="menu" className={`${MENU_PANEL} min-w-40`}>
          {locales.map((option) => (
            <button
              key={option.code}
              type="button"
              role="menuitem"
              lang={option.code}
              onClick={() => {
                setOpen(false)
                // Se guarda en el usuario, no solo en una cookie: la elección
                // debe seguirle al móvil y a los correos.
                router.post('/locale', { locale: option.code }, { preserveScroll: true })
              }}
              className={`block w-full px-3 py-2 text-left text-sm transition hover:bg-navy-50 ${
                option.code === locale ? 'font-semibold text-navy-700' : 'text-carbon'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AccountMenu({ shell }: { shell: Shell }) {
  const { t } = useI18n()
  const { open, setOpen, container, trigger } = useMenu()

  const initials = shell.actor.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('nav.shell.accountMenu')}
        className="flex items-center gap-2 rounded p-1 transition hover:bg-navy-50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-700 text-xs font-bold text-white">
          {initials || '?'}
        </span>
        <Chevron />
      </button>

      {open ? (
        <div role="menu" className={MENU_PANEL}>
          <div className="border-b border-steel-100 px-3 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium text-carbon">{shell.actor.name}</p>
            <p className="truncate text-xs text-steel-600">{shell.actor.email}</p>
            {shell.actor.role ? (
              <p className="mt-1 inline-block rounded-sm bg-navy-50 px-1.5 py-0.5 text-[11px] font-medium text-navy-700">
                {t(`nav.roles.${shell.actor.role}`)}
              </p>
            ) : null}
          </div>

          <Link
            href="/logout"
            method="post"
            as="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm text-carbon transition hover:bg-navy-50"
          >
            {t('nav.userMenu.signOut')}
          </Link>
        </div>
      ) : null}
    </div>
  )
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const { t } = useI18n()

  return (
    <nav aria-label={t('nav.breadcrumb.nav')} className="min-w-0">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        <li>
          <Link href="/home" className="text-steel-600 transition hover:text-navy-700">
            {t('nav.breadcrumb.home')}
          </Link>
        </li>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1

          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden="true" className="text-steel-400">
                /
              </span>
              {crumb.href && !last ? (
                <Link href={crumb.href} className="truncate text-steel-600 transition hover:text-navy-700">
                  {crumb.label}
                </Link>
              ) : (
                // La página actual no se enlaza a sí misma, y se marca con
                // aria-current para que un lector de pantalla sepa dónde acaba
                // la ruta.
                <span aria-current="page" className="truncate font-medium text-carbon">
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * La campana.
 *
 * Un enlace, no un desplegable: al pulsarla se va a la pantalla de avisos. Un
 * panel flotante con los últimos cinco obliga a decidir cuáles caben y deja al
 * resto escondido detrás de un «ver todos» que casi nadie pulsa.
 *
 * El número se lee del armazón, que lo trae en TODAS las páginas: así la
 * campana no depende de que cada controlador se acuerde de contarlos.
 */
function NotificationBell({ shell }: { shell: Shell }) {
  const { t } = useI18n()
  const sinLeer = shell.unreadNotifications

  return (
    <Link
      href="/notifications"
      aria-label={
        sinLeer > 0 ? t('notifications.bell.unread', { n: String(sinLeer) }) : t('notifications.bell.none')
      }
      className="relative rounded p-2 text-navy-700 transition hover:bg-navy-50"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true" className="h-5 w-5">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {sinLeer > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-safety-500 px-1 text-center text-[10px] font-bold leading-4 text-white"
        >
          {sinLeer > 99 ? '99+' : sinLeer}
        </span>
      ) : null}
    </Link>
  )
}

export function Topbar({
  shell,
  crumbs,
  onOpenNav,
}: {
  shell: Shell
  crumbs: Crumb[]
  onOpenNav: () => void
}) {
  const { t } = useI18n()

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-steel-200 bg-white px-4 sm:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label={t('nav.openMenu')}
        className="-ml-1 rounded p-2 text-navy-700 transition hover:bg-navy-50 lg:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true" className="h-5 w-5">
          <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
        </svg>
      </button>

      <Breadcrumbs crumbs={crumbs} />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <NotificationBell shell={shell} />
        <TenantSwitcher shell={shell} />
        <LocaleMenu />
        <AccountMenu shell={shell} />
      </div>
    </header>
  )
}
