import { Link, router } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface CompanyRow {
  id: string
  name: string
  website: string | null
  addressCity: string | null
  addressState: string | null
  active: boolean
  contactCount: number
  carrierCount: number
}

interface Props {
  companies: {
    data: CompanyRow[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }
  filters: { search: string; status: string }
  can: { manage: boolean }
}

function navigate(filters: Props['filters'], patch: Partial<Props['filters']>) {
  const next: Record<string, string> = { ...filters, ...patch }

  for (const key of Object.keys(next)) {
    if (next[key] === '') delete next[key]
  }

  router.get('/factoring', next, { preserveState: true, preserveScroll: true, replace: true })
}

export default function FactoringIndex({ companies, filters, can }: Props) {
  const { t } = useI18n()
  const [search, setSearch] = useState(filters.search)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false

      return
    }
    const timer = setTimeout(() => navigate(filters, { search }), 300)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const { meta } = companies
  const from = meta.total === 0 ? 0 : (meta.currentPage - 1) * meta.perPage + 1
  const to = Math.min(meta.currentPage * meta.perPage, meta.total)
  const filtered = Object.values(filters).some((v) => v !== '')

  return (
    <AppLayout
      title={t('factoring.index.title')}
      description={t('factoring.index.subtitle')}
      crumbs={[{ label: t('factoring.index.title') }]}
      actions={
        can.manage ? (
          <Link
            href="/factoring/create"
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
          >
            {t('factoring.index.new')}
          </Link>
        ) : undefined
      }
    >
      {/* Se dice en la propia pantalla para que nadie espere que aquí se
          adelante dinero: esto es una agenda, el dinero lo mueve la factoring
          con el transportista, fuera de aquí. */}
      <p className="rounded border border-steel-200 bg-navy-50/60 px-4 py-3 text-xs text-steel-700">
        {t('factoring.index.note')}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {[
          ['', 'all'],
          ['active', 'active'],
          ['inactive', 'inactive'],
        ].map(([value, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={filters.status === value}
            onClick={() => navigate(filters, { status: value })}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filters.status === value
                ? 'border-navy-700 bg-navy-700 text-white'
                : 'border-steel-300 bg-white text-steel-800 hover:bg-navy-50'
            }`}
          >
            {t(`factoring.filters.${label}`)}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="factoring-search" className="sr-only">
            {t('factoring.index.searchLabel')}
          </label>
          <input
            id="factoring-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('factoring.index.searchPlaceholder')}
            className="w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-steel-500 focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
        </div>
      </div>

      {companies.data.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-steel-300 bg-white p-10 text-center">
          <p className="font-display text-lg font-bold text-navy-700">
            {t(filtered ? 'factoring.index.noResults' : 'factoring.index.empty')}
          </p>
          <p className="mt-1 text-sm text-steel-700">
            {t(filtered ? 'factoring.index.noResultsHint' : 'factoring.index.emptyHint')}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded border border-steel-200 bg-white">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-steel-200 bg-navy-50 text-left">
                  {['name', 'website', 'location', 'contacts', 'carriers', 'status'].map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-steel-700"
                    >
                      {t(`factoring.columns.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companies.data.map((c) => (
                  <tr key={c.id} className="border-b border-steel-100 last:border-0 hover:bg-navy-50/60">
                    <td className="px-3 py-3">
                      <Link href={`/factoring/${c.id}`} className="font-medium text-navy-700 hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="max-w-56 truncate px-3 py-3 text-steel-700">
                      {c.website ? (
                        <a href={c.website} target="_blank" rel="noreferrer" className="hover:underline">
                          {c.website.replace(/^https?:\/\//, '')}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-3 text-steel-700">
                      {[c.addressCity, c.addressState].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-steel-700">{c.contactCount}</td>
                    <td className="px-3 py-3 tabular-nums text-steel-700">{c.carrierCount}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          c.active
                            ? 'bg-success-50 text-success-700 ring-success-500/40'
                            : 'bg-steel-100 text-steel-700 ring-steel-300'
                        }`}
                      >
                        {t(`factoring.status.${c.active ? 'active' : 'inactive'}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-steel-700">
            <p>{t('factoring.index.showing', { from, to, total: meta.total })}</p>
            {meta.lastPage > 1 ? (
              <div className="flex gap-1">
                {Array.from({ length: meta.lastPage }, (_, i) => i + 1).map((n) => (
                  <Link
                    key={n}
                    href={`/factoring?${new URLSearchParams({
                      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
                      page: String(n),
                    })}`}
                    aria-current={n === meta.currentPage ? 'page' : undefined}
                    preserveScroll
                    className={`rounded px-3 py-1.5 transition ${
                      n === meta.currentPage
                        ? 'bg-navy-700 font-semibold text-white'
                        : 'border border-steel-300 hover:bg-navy-50'
                    }`}
                  >
                    {n}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </>
      )}
    </AppLayout>
  )
}
