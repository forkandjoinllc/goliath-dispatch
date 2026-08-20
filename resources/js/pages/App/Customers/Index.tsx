import { Link, router } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import { formatCents } from '@/lib/format'

interface CustomerRow {
  id: string
  companyName: string
  city: string | null
  state: string | null
  email: string | null
  phone: string | null
  status: string
  paymentTermsDays: number | null
  creditLimitCents: number | null
  creditApproved: boolean
  loadCount: number
}

interface Props {
  customers: {
    data: CustomerRow[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }
  filters: { search: string; status: string; sort: string; direction: string }
  scope: string
  can: { create: boolean }
}

const STATUS_TONE: Record<string, string> = {
  active: 'bg-success-50 text-success-700 ring-success-500/40',
  inactive: 'bg-steel-100 text-steel-800 ring-steel-300',
  on_hold: 'bg-safety-100 text-safety-800 ring-safety-500/40',
}

function navigate(filters: Props['filters'], patch: Partial<Props['filters']>) {
  const next: Record<string, string> = { ...filters, ...patch }

  for (const key of Object.keys(next)) {
    if (
      next[key] === '' ||
      (key === 'sort' && next[key] === 'company_name') ||
      (key === 'direction' && next[key] === 'asc')
    ) {
      delete next[key]
    }
  }

  router.get('/customers', next, { preserveState: true, preserveScroll: true, replace: true })
}

export default function CustomersIndex({ customers, filters, scope, can }: Props) {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState(filters.search)
  const first = useRef(true)

  // Con retardo, por lo mismo que en transportistas: una petición por pulsación
  // llena el servidor de consultas que la siguiente letra invalida.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }

    const timer = setTimeout(() => navigate(filters, { search }), 300)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const { meta } = customers
  const from = meta.total === 0 ? 0 : (meta.currentPage - 1) * meta.perPage + 1
  const to = Math.min(meta.currentPage * meta.perPage, meta.total)
  const filtered = filters.search !== '' || filters.status !== ''

  const terms = (days: number | null): string =>
    days === null
      ? '—'
      : days === 0
        ? t('customers.detail.paymentTermsImmediate')
        : t('customers.detail.paymentTermsDays', { days })

  return (
    <AppLayout
      title={t('customers.index.title')}
      description={t('customers.index.subtitle')}
      crumbs={[{ label: t('customers.index.title') }]}
      actions={
        can.create ? (
          <Link
            href="/customers/create"
            className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700"
          >
            {t('customers.index.add')}
          </Link>
        ) : null
      }
    >
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-steel-600">
        {t(`customers.scope.${scope}`)}
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="customer-search" className="sr-only">
            {t('customers.index.searchLabel')}
          </label>
          <input
            id="customer-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('customers.index.searchPlaceholder')}
            className="w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-steel-500 focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium text-steel-700">
          {t('customers.filters.status')}
          <select
            value={filters.status}
            onChange={(e) => navigate(filters, { status: e.target.value })}
            className="rounded border border-steel-300 bg-white px-3 py-2 text-sm text-carbon outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          >
            <option value="">{t('customers.filters.all')}</option>
            {['active', 'inactive', 'on_hold'].map((s) => (
              <option key={s} value={s}>
                {t(`customers.status.${s}`)}
              </option>
            ))}
          </select>
        </label>

        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              router.get('/customers', {}, { preserveScroll: true, replace: true })
            }}
            className="rounded border border-steel-300 px-3 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
          >
            {t('customers.filters.clear')}
          </button>
        ) : null}
      </div>

      {customers.data.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-steel-300 bg-white p-10 text-center">
          <p className="font-display text-lg font-bold text-navy-700">
            {t(filtered ? 'customers.index.noResults' : 'customers.index.empty')}
          </p>
          <p className="mt-1 text-sm text-steel-700">
            {t(filtered ? 'customers.index.noResultsHint' : 'customers.index.emptyHint')}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded border border-steel-200 bg-white">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-steel-200 bg-navy-50 text-left">
                  <Th sortKey="company_name" filters={filters}>{t('customers.columns.customer')}</Th>
                  <Th sortKey="physical_city" filters={filters}>{t('customers.columns.location')}</Th>
                  <Th>{t('customers.columns.contact')}</Th>
                  <Th sortKey="payment_terms_days" filters={filters}>{t('customers.columns.terms')}</Th>
                  <Th sortKey="credit_limit_cents" filters={filters}>{t('customers.columns.credit')}</Th>
                  <Th>{t('customers.columns.loads')}</Th>
                  <Th sortKey="status" filters={filters}>{t('customers.columns.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {customers.data.map((c) => (
                  <tr key={c.id} className="border-b border-steel-100 last:border-0 hover:bg-navy-50/60">
                    <td className="px-3 py-3">
                      <Link
                        href={`/customers/${c.id}`}
                        className="font-medium text-navy-700 underline-offset-2 hover:underline"
                      >
                        {c.companyName}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-steel-700">
                      {c.city ? `${c.city}, ${c.state ?? ''}`.trim() : '—'}
                    </td>
                    <td className="px-3 py-3">
                      {c.email ? (
                        <span className="block truncate text-xs text-steel-600">{c.email}</span>
                      ) : null}
                      {c.phone ?? (c.email ? '' : '—')}
                    </td>
                    <td className="px-3 py-3 text-steel-700">{terms(c.paymentTermsDays)}</td>
                    <td className="px-3 py-3 tabular-nums">
                      {c.creditLimitCents === null ? (
                        <span className="text-steel-600">—</span>
                      ) : (
                        <>
                          {formatCents(c.creditLimitCents, locale)}
                          {/* Un límite sin aprobar no es un límite: decirlo aquí
                              evita que alguien despache contra crédito que
                              todavía no existe. */}
                          {!c.creditApproved ? (
                            <span className="block text-xs text-safety-700">
                              {t('customers.detail.creditApproved')}: {t('common.labels.no')}
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-steel-700">{c.loadCount}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          STATUS_TONE[c.status] ?? STATUS_TONE.inactive
                        }`}
                      >
                        {t(`customers.status.${c.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-steel-700">
            <p>{t('customers.index.showing', { from, to, total: meta.total })}</p>

            {meta.lastPage > 1 ? (
              <div className="flex gap-1">
                {Array.from({ length: meta.lastPage }, (_, i) => i + 1).map((n) => (
                  <Link
                    key={n}
                    href={`/customers?${new URLSearchParams({
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

function Th({
  children,
  sortKey,
  filters,
}: {
  children: React.ReactNode
  sortKey?: string
  filters?: Props['filters']
}) {
  if (!sortKey || !filters) {
    return (
      <th scope="col" className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-steel-700">
        {children}
      </th>
    )
  }

  const active = filters.sort === sortKey
  const direction = active && filters.direction === 'asc' ? 'desc' : 'asc'

  return (
    <th
      scope="col"
      aria-sort={active ? (filters.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-steel-700"
    >
      <button
        type="button"
        onClick={() => navigate(filters, { sort: sortKey, direction })}
        className="flex items-center gap-1 transition hover:text-navy-700"
      >
        {children}
        <span aria-hidden="true" className={active ? 'text-safety-600' : 'text-steel-400'}>
          {active && filters.direction === 'desc' ? '↓' : '↑'}
        </span>
      </button>
    </th>
  )
}
