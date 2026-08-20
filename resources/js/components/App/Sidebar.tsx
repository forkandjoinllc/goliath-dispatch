import { Link, usePage } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'
import { NavIcon } from '@/components/App/NavIcon'
import type { NavGroup, NavItem } from '@/types/app'
import type { SharedProps } from '@/types'

/**
 * El menú lateral. Los grupos y las entradas vienen YA FILTRADOS del servidor
 * (App\Support\Navigation): aquí no se decide quién ve qué, solo se pinta.
 *
 * Las entradas sin pantalla se pintan apagadas y como <span>, no como <a>. Es
 * más honesto que ocultarlas —dice «su rol alcanza esto, todavía no existe»— y
 * más honesto que enlazarlas, que sería prometer un 404.
 */

/** Activa si la URL actual es la entrada o algo colgando de ella (/carriers/17). */
function isActive(current: string, href: string): boolean {
  return current === href || current.startsWith(`${href}/`)
}

function Item({ item, current }: { item: NavItem; current: string }) {
  const { t } = useI18n()
  const label = t(item.labelKey)
  const icon = item.labelKey.split('.').pop() ?? 'dashboard'

  if (!item.ready) {
    // Apagada y con un reloj, no con una etiqueta de texto: con veintidós
    // entradas pendientes, veintidós veces «Próximamente» tapa los nombres, que
    // es justo lo que hay que leer. El texto sigue estando —en el `title` para
    // el ratón y en un `sr-only` para el lector de pantalla— pero no compite.
    return (
      <li>
        <span
          title={t('nav.pending.hint')}
          className="flex cursor-default items-center gap-3 rounded px-3 py-2 text-sm text-steel-500"
        >
          <NavIcon name={icon} />
          <span className="truncate">{label}</span>
          <span className="sr-only"> — {t('nav.pending.badge')}</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            aria-hidden="true"
            className="ml-auto h-3.5 w-3.5 shrink-0 text-steel-600"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5V12l3 1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </li>
    )
  }

  const active = isActive(current, item.href)

  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-3 rounded px-3 py-2 text-sm transition ${
          active
            ? 'bg-navy-800 font-semibold text-white shadow-[inset_3px_0_0_0_var(--color-safety-500)]'
            : 'text-navy-100 hover:bg-navy-800/60 hover:text-white'
        }`}
      >
        <NavIcon name={icon} />
        <span className="truncate">{label}</span>
      </Link>
    </li>
  )
}

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const { t, locale } = useI18n()
  const { url } = usePage<SharedProps>()

  // `url` de Inertia trae la query. Para decidir la entrada activa sobra.
  const current = url.split('?')[0] ?? '/'

  return (
    <nav aria-label={t('nav.mainNav')} className="flex h-full flex-col bg-navy-900 text-white">
      <div className="flex h-16 shrink-0 items-center border-b border-navy-800 px-5">
        <Link href={`/${locale}`} className="block">
          <img
            src="/brand/logo-reversed.png"
            srcSet="/brand/logo-reversed.png 1x, /brand/logo-reversed@2x.png 2x"
            alt="Goliath Dispatch"
            width={168}
            height={40}
            className="h-8 w-auto"
          />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-1">
          <Item
            item={{ href: '/home', labelKey: 'nav.primary.dashboard', ready: true }}
            current={current}
          />
        </ul>

        {groups.map((group) => (
          <div key={group.key} className="mt-6">
            <h2 className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-steel-400">
              {t(group.labelKey)}
            </h2>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <Item key={item.href} item={item} current={current} />
              ))}
            </ul>
          </div>
        ))}

        {groups.length === 0 ? (
          // Un rol sin ninguna entrada no es imposible: un conductor con la
          // cuenta recién creada. Decirlo es mejor que una columna vacía.
          <p className="mt-6 px-3 text-sm text-steel-400">{t('common.states.permissionDenied')}</p>
        ) : null}
      </div>

      <div className="hazard-stripe h-1 shrink-0" aria-hidden="true" />
    </nav>
  )
}
