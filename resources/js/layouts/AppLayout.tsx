import { Head, usePage } from '@inertiajs/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Sidebar } from '@/components/App/Sidebar'
import { Topbar } from '@/components/App/Topbar'
import { useI18n } from '@/lib/i18n'
import type { SharedProps } from '@/types'
import type { Crumb } from '@/types/app'

/**
 * El armazón de toda pantalla autenticada.
 *
 * Todo lo que pinta —menú, empresa activa, empresas disponibles— viene de la
 * prop compartida `shell`, que el servidor construye ya filtrada por permisos
 * (App\Support\AppShell). Este componente no toma NINGUNA decisión de
 * autorización: si la tomara, tarde o temprano diferiría de la del servidor, y
 * la que manda es siempre la del servidor.
 */
export function AppLayout({
  title,
  heading,
  description,
  crumbs = [],
  actions,
  children,
}: {
  title: string
  /** El H1. Si se omite se usa `title`. */
  heading?: string
  description?: string
  crumbs?: Crumb[]
  /** Botones de la cabecera de página: crear, exportar, etc. */
  actions?: ReactNode
  children: ReactNode
}) {
  const { t } = useI18n()
  const { shell, flash } = usePage<SharedProps>().props
  const [navOpen, setNavOpen] = useState(false)

  // El cajón lateral se cierra al navegar. Sin esto, en un móvil quien pulsa
  // una entrada ve la página nueva tapada por el menú que acaba de usar.
  const { url } = usePage<SharedProps>()
  useEffect(() => setNavOpen(false), [url])

  // `== null` y no `=== null`: atrapa también `undefined`. Con la comparación
  // estricta, una página renderizada sin la prop compartida —le pasó a la
  // pantalla de suspensión por un middleware mal colocado— se colaba por aquí y
  // reventaba dos líneas más abajo leyendo `shell.nav`. La guarda existía y no
  // guardaba del caso más probable.
  if (shell == null) {
    // No debería ocurrir: estas páginas van tras el middleware `auth`. Si
    // ocurre, decirlo es mejor que reventar con «cannot read property of null».
    return (
      <>
        <Head title={title} />
        <p className="p-8 text-sm text-steel-700">{t('common.states.permissionDenied')}</p>
      </>
    )
  }

  return (
    <>
      <Head title={title} />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-navy-700 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('nav.skipToContent')}
      </a>

      <div className="flex min-h-dvh bg-navy-50">
        {/* Columna fija en escritorio */}
        <div className="hidden w-64 shrink-0 lg:block">
          <div className="fixed inset-y-0 left-0 w-64">
            <Sidebar groups={shell.nav} />
          </div>
        </div>

        {/* Cajón en móvil */}
        {navOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label={t('common.a11y.closeDialog')}
              onClick={() => setNavOpen(false)}
              className="absolute inset-0 bg-carbon/50"
            />
            <div className="absolute inset-y-0 left-0 w-64">
              <Sidebar groups={shell.nav} />
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar shell={shell} crumbs={crumbs} onOpenNav={() => setNavOpen(true)} />

          {shell.actor.impersonating ? (
            // Franja permanente, no un aviso que se cierra. Quien suplanta debe
            // tener delante en todo momento que no es él quien firma lo que hace.
            <p
              role="status"
              className="bg-safety-500 px-4 py-2 text-center text-sm font-medium text-carbon sm:px-6"
            >
              {t('nav.userMenu.impersonating', { name: shell.actor.name })} ·{' '}
              {t('nav.impersonation.recorded')}
            </p>
          ) : null}

          {shell.actor.mfaRequired && !shell.actor.mfaSatisfied ? (
            <p role="alert" className="border-b border-safety-200 bg-safety-50 px-4 py-2 text-sm text-carbon sm:px-6">
              {t('nav.shell.mfaPending')}
            </p>
          ) : null}

          <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="font-display text-2xl font-bold text-navy-700 sm:text-3xl">
                    {heading ?? title}
                  </h1>
                  {description ? (
                    <p className="mt-1 max-w-2xl text-sm text-steel-700">{description}</p>
                  ) : null}
                </div>
                {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
              </div>

              {flash.success ? (
                <p role="status" className="mt-4 rounded border-l-4 border-success-500 bg-success-50 p-3 text-sm text-carbon">
                  {flash.success}
                </p>
              ) : null}
              {/* Ni éxito ni error: la operación salió y algo de lo que
                  arrastraba no. Ámbar y `role="status"`, no `alert`: no ha
                  fallado nada que haya que deshacer. */}
              {flash.warning ? (
                <p role="status" className="mt-4 rounded border-l-4 border-warning-500 bg-warning-50 p-3 text-sm text-carbon">
                  {flash.warning}
                </p>
              ) : null}
              {flash.error ? (
                <p role="alert" className="mt-4 rounded border-l-4 border-danger-500 bg-danger-50 p-3 text-sm text-carbon">
                  {flash.error}
                </p>
              ) : null}

              <div className="mt-6">{children}</div>
            </div>
          </main>
        </div>
      </div>
    </>
  )
}
