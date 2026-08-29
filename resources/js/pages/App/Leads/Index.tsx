import { Link, router } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { Pager, type PageMeta } from '@/components/App/Pager'
import { useI18n } from '@/lib/i18n'

interface Row {
  id: string
  name: string
  email: string
  phone: string | null
  companyName: string | null
  dotNumber: string | null
  status: string
  source: string
  assignedToId: string | null
  assignedToName: string | null
  createdOn: string
}

interface Filters {
  status: string
  source: string
  assigned: string
  q: string
  from: string | null
  to: string | null
}

interface Props {
  leads: { data: Row[]; meta: PageMeta }
  filters: Filters
  statuses: string[]
  sources: string[]
  counts: Record<string, number>
  assignees: { id: string; name: string; email: string }[]
  can: { update: boolean }
}

export default function LeadsIndex({ leads, filters, statuses, sources, counts, assignees }: Props) {
  const { t } = useI18n()

  const filtrar = (patch: Partial<Record<keyof Filters, string>>) =>
    router.get('/leads', limpiar({ ...filters, ...patch }), { preserveState: true, replace: true })

  const hayFiltros = Object.values(filters).some((v) => v !== '' && v !== null)
  const totalDelEmbudo = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <AppLayout
      title={t('leads.index.title')}
      description={t('leads.index.subtitle')}
      crumbs={[{ label: t('leads.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        {/* El embudo entero, sin los filtros aplicados: son para navegar, y si
            cambiaran con el filtro no servirían para eso. */}
        <div className="grid gap-3 sm:grid-cols-5">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => filtrar({ status: filters.status === s ? '' : s })}
              aria-pressed={filters.status === s}
              className={`rounded border p-4 text-left transition ${
                filters.status === s
                  ? 'border-navy-500 bg-navy-50'
                  : 'border-steel-200 bg-white hover:bg-navy-50'
              }`}
            >
              <p className="text-xs uppercase tracking-wide text-steel-600">{t(`leads.status.${s}`)}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-carbon">{counts[s] ?? 0}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Filtro label={t('leads.index.source')}>
            <select value={filters.source} onChange={(e) => filtrar({ source: e.target.value })} className={CAMPO}>
              <option value="">{t('leads.index.anySource')}</option>
              {sources.map((s) => (
                <option key={s} value={s}>{t(`leads.source.${s}`)}</option>
              ))}
            </select>
          </Filtro>

          <Filtro label={t('leads.index.assigned')}>
            <select value={filters.assigned} onChange={(e) => filtrar({ assigned: e.target.value })} className={CAMPO}>
              <option value="">{t('leads.index.anyAssigned')}</option>
              <option value="unassigned">{t('leads.index.unassigned')}</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>{a.name || a.email}</option>
              ))}
            </select>
          </Filtro>

          <Filtro label={t('leads.index.from')}>
            <input
              type="date"
              defaultValue={filters.from ?? ''}
              onChange={(e) => filtrar({ from: e.target.value })}
              className={CAMPO}
            />
          </Filtro>

          <Filtro label={t('leads.index.to')}>
            <input
              type="date"
              defaultValue={filters.to ?? ''}
              onChange={(e) => filtrar({ to: e.target.value })}
              className={CAMPO}
            />
          </Filtro>

          <Filtro label={t('leads.index.search')}>
            <input
              type="search"
              defaultValue={filters.q}
              onBlur={(e) => filtrar({ q: e.target.value })}
              placeholder={t('leads.index.searchPlaceholder')}
              className={`${CAMPO} min-w-64`}
            />
          </Filtro>

          {hayFiltros ? (
            <button
              type="button"
              onClick={() => router.get('/leads', {}, { preserveState: true, replace: true })}
              className="rounded border border-steel-300 px-3 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
            >
              {t('leads.index.clear')}
            </button>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded border border-steel-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-steel-50 text-xs uppercase tracking-wide text-steel-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('leads.index.who')}</th>
                <th className="px-4 py-2.5 font-medium">{t('leads.index.company')}</th>
                <th className="px-4 py-2.5 font-medium">{t('leads.index.source')}</th>
                <th className="px-4 py-2.5 font-medium">{t('leads.index.status')}</th>
                <th className="px-4 py-2.5 font-medium">{t('leads.index.owner')}</th>
                <th className="px-4 py-2.5 font-medium">{t('leads.index.received')}</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {leads.data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-steel-600">
                    {/* Vacío por filtro y vacío de verdad no son lo mismo: el
                        segundo tiene que explicar de dónde vienen los prospectos. */}
                    {totalDelEmbudo === 0 ? t('leads.index.emptyAll') : t('leads.index.empty')}
                  </td>
                </tr>
              ) : null}

              {leads.data.map((l) => (
                <tr key={l.id} className="border-t border-steel-100">
                  <td className="px-4 py-2.5">
                    <Link href={`/leads/${l.id}`} className="font-medium text-navy-700 underline">
                      {l.name}
                    </Link>
                    <p className="text-xs text-steel-600">{l.email}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {l.companyName ?? <span className="text-steel-500">{t('leads.index.nobody')}</span>}
                    {l.dotNumber ? <p className="text-xs text-steel-600">DOT {l.dotNumber}</p> : null}
                  </td>
                  <td className="px-4 py-2.5 text-steel-700">{t(`leads.source.${l.source}`)}</td>
                  <td className="px-4 py-2.5">{t(`leads.status.${l.status}`)}</td>
                  <td className="px-4 py-2.5">
                    {l.assignedToName ?? (
                      <span className="text-steel-500">{t('leads.index.unassigned')}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-steel-700">{l.createdOn}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/leads/${l.id}`} className="text-navy-700 underline">
                      {t('leads.index.view')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pager meta={leads.meta} path="/leads" params={{ ...filters }} />
      </div>
    </AppLayout>
  )
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
