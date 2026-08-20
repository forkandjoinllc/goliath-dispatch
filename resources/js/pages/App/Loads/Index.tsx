import { Link, router } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import { StatusBadge } from '@/components/App/StatusBadge'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import { formatCents } from '@/lib/format'

interface LoadRow {
  id: string
  loadNumber: string
  status: string
  customer: string | null
  carrier: string | null
  commodity: string | null
  isOversize: boolean
  plannedPickupAt: string | null
  plannedDeliveryAt: string | null
  miles: number | null
  customerChargeCents: number | null
  carrierGrossRateCents: number | null
}

interface Props {
  loads: {
    data: LoadRow[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }
  filters: {
    search: string
    status: string
    customer: string
    carrier: string
    sort: string
    direction: string
  }
  scope: string
  facets: Record<string, number>
  options: {
    customers: { id: string; name: string }[]
    carriers: { id: string; name: string }[]
  }
  showMoney: boolean
  can: { create: boolean }
}

/** Los estados que merecen un atajo. El resto vive en el desplegable. */
const QUICK = ['available', 'assigned', 'dispatched', 'in_transit', 'delivered']

const ALL_STATUSES = [
  'draft', 'available', 'assigned', 'dispatched', 'en_route_to_pickup', 'at_pickup',
  'in_transit', 'at_delivery', 'delivered', 'pod_received', 'invoiced', 'paid', 'cancelled',
]

function navigate(filters: Props['filters'], patch: Partial<Props['filters']>) {
  const next: Record<string, string> = { ...filters, ...patch }

  for (const key of Object.keys(next)) {
    if (
      next[key] === '' ||
      (key === 'sort' && next[key] === 'planned_pickup_at') ||
      (key === 'direction' && next[key] === 'desc')
    ) {
      delete next[key]
    }
  }

  router.get('/loads', next, { preserveState: true, preserveScroll: true, replace: true })
}

export default function LoadsIndex({
  loads, filters, scope, facets, options, showMoney, can,
}: Props) {
  const { t, locale } = useI18n()
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

  const { meta } = loads
  const from = meta.total === 0 ? 0 : (meta.currentPage - 1) * meta.perPage + 1
  const to = Math.min(meta.currentPage * meta.perPage, meta.total)
  const filtered =
    filters.search !== '' || filters.status !== '' || filters.customer !== '' || filters.carrier !== ''

  const day = (value: string | null): string =>
    value
      ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
          month: 'short', day: 'numeric',
        }).format(new Date(value))
      : '—'

  return (
    <AppLayout
      title={t('loads.index.title')}
      description={t('loads.index.subtitle')}
      crumbs={[{ label: t('loads.index.title') }]}
      actions={
        can.create ? (
          <Link
            href="/loads/create"
            className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700"
          >
            {t('loads.index.add')}
          </Link>
        ) : null
      }
    >
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-steel-600">
        {t(`loads.scope.${scope}`)}
      </p>

      {/* Atajos por estado, con el recuento dentro del ámbito */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        <FacetChip
          label={t('loads.filters.all')}
          count={facets.all ?? 0}
          active={filters.status === ''}
          onClick={() => navigate(filters, { status: '' })}
        />
        {QUICK.map((s) => (
          <FacetChip
            key={s}
            label={t(`nav.status.load.${s.replace(/_(.)/g, (_, c: string) => c.toUpperCase())}`)}
            count={facets[s] ?? 0}
            active={filters.status === s}
            onClick={() => navigate(filters, { status: filters.status === s ? '' : s })}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="load-search" className="sr-only">
            {t('loads.index.searchLabel')}
          </label>
          <input
            id="load-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('loads.index.searchPlaceholder')}
            className="w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-steel-500 focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
        </div>

        <Select
          label={t('loads.filters.status')}
          value={filters.status}
          onChange={(v) => navigate(filters, { status: v })}
          options={[
            { value: '', label: t('loads.filters.all') },
            ...ALL_STATUSES.map((s) => ({
              value: s,
              label: t(`nav.status.load.${s.replace(/_(.)/g, (_, c: string) => c.toUpperCase())}`),
            })),
          ]}
        />

        {options.customers.length > 1 ? (
          <Select
            label={t('loads.filters.customer')}
            value={filters.customer}
            onChange={(v) => navigate(filters, { customer: v })}
            options={[
              { value: '', label: t('loads.filters.all') },
              ...options.customers.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        ) : null}

        {options.carriers.length > 1 ? (
          <Select
            label={t('loads.filters.carrier')}
            value={filters.carrier}
            onChange={(v) => navigate(filters, { carrier: v })}
            options={[
              { value: '', label: t('loads.filters.all') },
              ...options.carriers.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        ) : null}

        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              router.get('/loads', {}, { preserveScroll: true, replace: true })
            }}
            className="rounded border border-steel-300 px-3 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
          >
            {t('loads.filters.clear')}
          </button>
        ) : null}
      </div>

      {loads.data.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-steel-300 bg-white p-10 text-center">
          <p className="font-display text-lg font-bold text-navy-700">
            {t(filtered ? 'loads.index.noResults' : 'loads.index.empty')}
          </p>
          <p className="mt-1 text-sm text-steel-700">
            {t(filtered ? 'loads.index.noResultsHint' : 'loads.index.emptyHint')}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded border border-steel-200 bg-white">
            <table className="w-full min-w-[54rem] text-sm">
              <thead>
                <tr className="border-b border-steel-200 bg-navy-50 text-left">
                  <Th sortKey="load_number" filters={filters}>{t('loads.columns.load')}</Th>
                  <Th>{t('loads.columns.customer')}</Th>
                  <Th>{t('loads.columns.carrier')}</Th>
                  <Th sortKey="planned_pickup_at" filters={filters}>{t('loads.columns.pickup')}</Th>
                  <Th sortKey="planned_delivery_at" filters={filters}>{t('loads.columns.delivery')}</Th>
                  {/* La columna de dinero no se pinta en absoluto cuando el
                      servidor no la mandó. Una columna vacía preguntaría por qué. */}
                  {showMoney ? (
                    <Th sortKey="customer_charge_cents" filters={filters}>
                      {t('loads.columns.charge')}
                    </Th>
                  ) : null}
                  <Th sortKey="status" filters={filters}>{t('loads.columns.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {loads.data.map((l) => (
                  <tr key={l.id} className="border-b border-steel-100 last:border-0 hover:bg-navy-50/60">
                    <td className="px-3 py-3">
                      <Link
                        href={`/loads/${l.id}`}
                        className="font-medium tabular-nums text-navy-700 underline-offset-2 hover:underline"
                      >
                        {l.loadNumber}
                      </Link>
                      {l.commodity ? (
                        <span className="block max-w-48 truncate text-xs text-steel-600">
                          {l.commodity}
                        </span>
                      ) : null}
                      {l.isOversize ? (
                        <span className="mt-0.5 inline-flex rounded bg-safety-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-safety-800">
                          {t('loads.detail.oversize')}
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-40 truncate px-3 py-3 text-steel-700">{l.customer ?? '—'}</td>
                    <td className="max-w-40 truncate px-3 py-3 text-steel-700">{l.carrier ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-steel-700">
                      {day(l.plannedPickupAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-steel-700">
                      {day(l.plannedDeliveryAt)}
                    </td>
                    {showMoney ? (
                      <td className="px-3 py-3 tabular-nums">
                        {l.customerChargeCents === null
                          ? '—'
                          : formatCents(l.customerChargeCents, locale)}
                      </td>
                    ) : null}
                    <td className="px-3 py-3">
                      <StatusBadge family="load" value={l.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-steel-700">
            <p>{t('loads.index.showing', { from, to, total: meta.total })}</p>

            {meta.lastPage > 1 ? (
              <div className="flex gap-1">
                {Array.from({ length: meta.lastPage }, (_, i) => i + 1).map((n) => (
                  <Link
                    key={n}
                    href={`/loads?${new URLSearchParams({
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

function FacetChip({
  label, count, active, onClick,
}: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-navy-700 bg-navy-700 text-white'
          : 'border-steel-300 bg-white text-steel-800 hover:bg-navy-50'
      }`}
    >
      {label}
      <span className={`ml-1.5 tabular-nums ${active ? 'text-navy-100' : 'text-steel-500'}`}>
        {count}
      </span>
    </button>
  )
}

function Select({
  label, value, onChange, options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-steel-700">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-48 rounded border border-steel-300 bg-white px-3 py-2 text-sm text-carbon outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Th({
  children, sortKey, filters,
}: { children: React.ReactNode; sortKey?: string; filters?: Props['filters'] }) {
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
