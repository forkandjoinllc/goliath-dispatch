import { Link, usePage } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import type { SharedProps } from '@/types'

interface Permission {
  key: string
  action: string
  scope: string | null
  description: string
}

interface Card {
  key: string
  group: string
  count: number
  href: string
  tone: 'danger' | 'warn' | 'neutral'
}

interface Props {
  cards: Card[]
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

/** El orden en que se leen los grupos. No es alfabético: es el de la jornada. */
const GROUPS = ['operations', 'compliance', 'finance', 'commercial'] as const

/**
 * El panel de entrada.
 *
 * Arriba, lo que hay pendiente: cada tarjeta es una pregunta que alguien se
 * hace de verdad al abrir la aplicación, y al pulsarla lleva a la lista ya
 * filtrada que la contesta. Un número sobre el que no se puede actuar sería
 * decoración, así que aquí no hay ninguno.
 *
 * Abajo y plegada, la matriz de permisos. Estaba sola en esta pantalla y no se
 * ha quitado: mientras los dominios se construyen, sigue siendo el único sitio
 * donde se puede señalar «ese ámbito está mal» antes de que lo descubra un
 * cliente. Lo que cambia es el orden de importancia.
 */
export default function Dashboard({ cards, permissions, totals }: Props) {
  const { t } = useI18n()
  const { shell } = usePage<SharedProps>().props
  const [verPermisos, setVerPermisos] = useState(false)

  const resources = Object.keys(permissions)
  const roleLabel = shell?.actor.role ? t(`nav.roles.${shell.actor.role}`) : '—'

  const grupos = GROUPS.map((g) => [g, cards.filter((c) => c.group === g)] as const).filter(
    ([, items]) => items.length > 0,
  )

  return (
    <AppLayout
      title={t('nav.primary.dashboard')}
      heading={shell?.tenant?.name ?? t('nav.shell.platformScope')}
      description={t('dashboard.subtitle')}
    >
      <div className="flex flex-col gap-8">
        {grupos.length === 0 ? (
          <div className="rounded border border-dashed border-steel-300 bg-white p-8 text-center">
            <p className="font-semibold text-carbon">{t('dashboard.empty.title')}</p>
            <p className="mt-1 text-sm text-steel-600">{t('dashboard.empty.body')}</p>
          </div>
        ) : null}

        {grupos.map(([grupo, items]) => (
          <section key={grupo}>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-steel-600">
              {t(`dashboard.groups.${grupo}`)}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {items.map((c) => (
                <Tarjeta key={c.key} card={c} />
              ))}
            </div>
          </section>
        ))}

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-steel-600">
              {t('dashboard.permissions.title')}
            </h2>
            <button
              type="button"
              onClick={() => setVerPermisos((v) => !v)}
              aria-expanded={verPermisos}
              className="text-sm text-navy-700 underline"
            >
              {verPermisos ? t('dashboard.permissions.hide') : t('dashboard.permissions.show')}
            </button>
          </div>

          <p className="mt-1 text-xs text-steel-600">
            {t('dashboard.permissions.granted', {
              n: String(totals.granted),
              catalog: String(totals.catalog),
            })}
            {' · '}
            {roleLabel}
          </p>

          {verPermisos ? (
            <>
              <p className="mt-3 text-xs text-steel-600">{t('dashboard.permissions.hint')}</p>

              {resources.length === 0 ? (
                <p className="mt-3 rounded border border-dashed border-steel-300 bg-white p-6 text-sm text-steel-700">
                  {t('common.states.permissionDenied')} — {t('common.states.permissionDeniedHint')}
                </p>
              ) : (
                <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
            </>
          ) : null}
        </section>
      </div>
    </AppLayout>
  )
}

/**
 * Una cifra pendiente, con su enlace.
 *
 * En cero se pinta apagada y sigue siendo un enlace: que hoy no haya nada no
 * quiere decir que no se quiera mirar, y hacerla desaparecer movería las demás
 * de sitio cada vez que cambia un número.
 */
function Tarjeta({ card }: { card: Card }) {
  const { t } = useI18n()
  const vacia = card.count === 0

  const tono = vacia
    ? 'border-steel-200 bg-white'
    : card.tone === 'danger'
      ? 'border-danger-300 bg-danger-50'
      : card.tone === 'warn'
        ? 'border-safety-300 bg-safety-50'
        : 'border-steel-200 bg-white'

  const cifra = vacia
    ? 'text-steel-400'
    : card.tone === 'danger'
      ? 'text-danger-700'
      : card.tone === 'warn'
        ? 'text-safety-700'
        : 'text-navy-700'

  return (
    <Link
      href={card.href}
      className={`flex flex-col rounded border p-4 transition hover:border-navy-400 ${tono}`}
    >
      <span className={`font-display text-3xl font-bold tabular-nums ${cifra}`}>{card.count}</span>
      <span className="mt-1 text-sm font-medium text-carbon">
        {t(`dashboard.cards.${card.key}.label`)}
      </span>
      <span className="mt-0.5 text-xs text-steel-600">{t(`dashboard.cards.${card.key}.hint`)}</span>
    </Link>
  )
}
