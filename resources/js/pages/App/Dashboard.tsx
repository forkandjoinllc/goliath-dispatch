import { usePage } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import type { SharedProps } from '@/types'

interface Permission {
  key: string
  action: string
  scope: string | null
  description: string
}

interface Props {
  permissions: Record<string, Permission[]>
  totals: { granted: number; catalog: number; roleGrants: number }
}

/** Cada ámbito con su color. El naranja de marca marca el más ancho. */
const SCOPE_STYLE: Record<string, string> = {
  platform: 'bg-safety-100 text-safety-800',
  tenant: 'bg-navy-100 text-navy-800',
  assigned: 'bg-steel-100 text-steel-800',
  carrier: 'bg-steel-100 text-steel-800',
  own: 'bg-steel-100 text-steel-700',
}

/**
 * El panel de entrada.
 *
 * Enseña, con su ámbito, los permisos exactos que este rol concede en esta
 * empresa. Es deliberadamente literal: mientras los dominios se construyen, esta
 * pantalla es el sitio donde se puede señalar «ese ámbito está mal» antes de que
 * lo descubra un cliente.
 */
export default function Dashboard({ permissions, totals }: Props) {
  const { t, locale } = useI18n()
  const { shell } = usePage<SharedProps>().props

  const resources = Object.keys(permissions)
  const roleLabel = shell?.actor.role ? t(`nav.roles.${shell.actor.role}`) : '—'

  return (
    <AppLayout
      title={t('nav.primary.dashboard')}
      heading={shell?.tenant?.name ?? t('nav.shell.platformScope')}
      description={
        locale === 'es'
          ? `Está actuando como ${roleLabel}. Estos son los permisos que ese rol concede aquí.`
          : `You are acting as ${roleLabel}. These are the permissions that role grants here.`
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={locale === 'es' ? 'permisos concedidos' : 'permissions granted'}
          value={totals.granted}
          accent
        />
        <Stat label={locale === 'es' ? 'catálogo completo' : 'full catalogue'} value={totals.catalog} />
        <Stat
          label={locale === 'es' ? 'concesiones del rol' : 'role grants'}
          value={totals.roleGrants}
        />
      </div>

      <h2 className="mt-10 font-display text-xl font-bold text-navy-700">
        {locale === 'es' ? 'Lo que puede hacer este rol' : 'What this role can do'}
      </h2>

      {resources.length === 0 ? (
        <p className="mt-4 rounded border border-dashed border-steel-300 bg-white p-6 text-sm text-steel-700">
          {t('common.states.permissionDenied')} — {t('common.states.permissionDeniedHint')}
        </p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {resources.map((resource) => (
            <section key={resource} className="rounded border border-steel-200 bg-white p-5">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-safety-600">
                {resource}
              </h3>
              <ul className="mt-3 flex flex-col gap-2">
                {permissions[resource]!.map((p) => (
                  <li key={p.key} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        SCOPE_STYLE[p.scope ?? 'own'] ?? 'bg-steel-100 text-steel-700'
                      }`}
                    >
                      {p.scope}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium text-carbon">{p.action}</span>
                      <span className="block text-xs text-steel-600">{p.description}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AppLayout>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded border border-steel-200 bg-white p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-steel-600">{label}</p>
      <p
        className={`mt-1 font-display text-3xl font-bold ${accent ? 'text-safety-600' : 'text-navy-700'}`}
      >
        {value}
      </p>
    </div>
  )
}
