import { Link, router } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { Pager, type PageMeta } from '@/components/App/Pager'
import { useI18n } from '@/lib/i18n'

interface Row {
  id: string
  occurredAt: string
  action: string
  entityType: string | null
  entityId: string | null
  entityLabel: string | null
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
  actorRole: string | null
  reason: string | null
  impersonated: boolean
  hasDetail: boolean
}

interface Filters {
  action: string
  entityType: string
  actor: string
  q: string
  from: string | null
  to: string | null
}

interface Props {
  events: { data: Row[]; meta: PageMeta }
  filters: Filters
  actions: string[]
  entityTypes: string[]
  actors: { id: string; name: string; email: string }[]
}

export default function AuditIndex({ events, filters, actions, entityTypes, actors }: Props) {
  const { t } = useI18n()

  const filtrar = (patch: Partial<Record<keyof Filters, string>>) =>
    router.get('/audit', limpiar({ ...filters, ...patch }), { preserveState: true, replace: true })

  const hayFiltros = Object.values(filters).some((v) => v !== '' && v !== null)

  return (
    <AppLayout
      title={t('audit.index.title')}
      description={t('audit.index.subtitle')}
      crumbs={[{ label: t('audit.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Filtro label={t('audit.index.action')}>
            <select value={filters.action} onChange={(e) => filtrar({ action: e.target.value })} className={CAMPO}>
              <option value="">{t('audit.index.anyAction')}</option>
              {actions.map((a) => (
                <option key={a} value={a}>{t(`audit.action.${a}`)}</option>
              ))}
            </select>
          </Filtro>

          <Filtro label={t('audit.index.entityType')}>
            <select
              value={filters.entityType}
              onChange={(e) => filtrar({ entityType: e.target.value })}
              className={CAMPO}
            >
              <option value="">{t('audit.index.anyEntityType')}</option>
              {entityTypes.map((e) => (
                <option key={e} value={e}>{t(`audit.entity.${e}`)}</option>
              ))}
            </select>
          </Filtro>

          <Filtro label={t('audit.index.actor')}>
            <select value={filters.actor} onChange={(e) => filtrar({ actor: e.target.value })} className={CAMPO}>
              <option value="">{t('audit.index.anyActor')}</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>{a.name || a.email}</option>
              ))}
            </select>
          </Filtro>

          <Filtro label={t('audit.index.from')}>
            <input
              type="date"
              defaultValue={filters.from ?? ''}
              onChange={(e) => filtrar({ from: e.target.value })}
              className={CAMPO}
            />
          </Filtro>

          <Filtro label={t('audit.index.to')}>
            <input
              type="date"
              defaultValue={filters.to ?? ''}
              onChange={(e) => filtrar({ to: e.target.value })}
              className={CAMPO}
            />
          </Filtro>

          <Filtro label={t('audit.index.search')}>
            <input
              type="search"
              defaultValue={filters.q}
              onBlur={(e) => filtrar({ q: e.target.value })}
              placeholder={t('audit.index.searchPlaceholder')}
              className={`${CAMPO} min-w-64`}
            />
          </Filtro>

          {hayFiltros ? (
            <button
              type="button"
              onClick={() => router.get('/audit', {}, { preserveState: true, replace: true })}
              className="rounded border border-steel-300 px-3 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
            >
              {t('audit.index.clear')}
            </button>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded border border-steel-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-steel-50 text-xs uppercase tracking-wide text-steel-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('audit.index.when')}</th>
                <th className="px-4 py-2.5 font-medium">{t('audit.index.who')}</th>
                <th className="px-4 py-2.5 font-medium">{t('audit.index.what')}</th>
                <th className="px-4 py-2.5 font-medium">{t('audit.index.record')}</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {events.data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-steel-600">
                    {t('audit.index.empty')}
                  </td>
                </tr>
              ) : null}

              {events.data.map((e) => (
                <tr key={e.id} className="border-t border-steel-100 align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-steel-700">
                    {cuando(e.occurredAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-carbon">
                      {e.actorName || e.actorEmail || t('audit.index.unknownActor')}
                    </span>
                    {e.actorRole ? (
                      <span className="ml-2 text-xs text-steel-600">{t(`users.roles.${e.actorRole}`)}</span>
                    ) : null}
                    {/* Que la acción se hiciera con un acceso de soporte cambia
                        cómo se lee la fila entera, así que va junto al nombre y
                        no escondido en el detalle. */}
                    {e.impersonated ? (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        {t('audit.index.impersonated')}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    {t(`audit.action.${e.action}`)}
                    {e.reason ? <p className="mt-0.5 text-xs text-steel-600">{e.reason}</p> : null}
                  </td>
                  <td className="px-4 py-2.5">
                    {e.entityType ? (
                      <>
                        <span className="text-steel-600">{t(`audit.entity.${e.entityType}`)}</span>
                        {e.entityLabel ? (
                          <span className="ml-2 text-carbon">{e.entityLabel}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-steel-500">{t('audit.index.noRecord')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/audit/${e.id}`} className="text-navy-700 underline">
                      {t('audit.index.view')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pager meta={events.meta} path="/audit" params={{ ...filters }} />
      </div>
    </AppLayout>
  )
}

/**
 * `2026-08-29 17:04:11.482` tal cual es ilegible de un vistazo, y la columna se
 * lee en vertical. Se quitan los milisegundos y se deja la fecha y la hora.
 */
function cuando(valor: string): string {
  return valor.slice(0, 19).replace('T', ' ')
}

function limpiar(f: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(f).filter(([, v]) => v !== '' && v !== null) as [string, string][],
  )
}

const CAMPO =
  'rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'

function Filtro({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-steel-700">{label}</span>
      {children}
    </label>
  )
}
