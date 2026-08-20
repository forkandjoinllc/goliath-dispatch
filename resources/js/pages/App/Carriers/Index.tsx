import { Link, router } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import { StatusBadge } from '@/components/App/StatusBadge'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface CarrierRow {
  id: string
  legalName: string
  dba: string | null
  dotNumber: string
  mcNumber: string | null
  city: string | null
  state: string | null
  contact: string
  email: string
  phone: string
  preferredLocale: string
  onboardingStatus: string | null
  fmcsaStatus: string | null
  dispatchFeeBps: number
  lastActivityAt: string | null
}

interface Props {
  carriers: {
    data: CarrierRow[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }
  filters: { search: string; onboarding: string; fmcsa: string; sort: string; direction: string }
  facets: Record<string, number>
  scope: string
  can: { create: boolean; readOnboarding: boolean }
}

const ONBOARDING_ORDER = [
  'draft',
  'submitted',
  'under_review',
  'corrections_required',
  'approved',
  'rejected',
  'suspended',
]

const FMCSA_ORDER = [
  'not_started',
  'pending',
  'verified',
  'mismatch',
  'failed',
  'manually_overridden',
  'expired',
]

/** Recarga con los filtros nuevos, conservando los que no se tocaron. */
function navigate(filters: Props['filters'], patch: Partial<Props['filters']>) {
  const next: Record<string, string> = { ...filters, ...patch }

  // Los valores vacíos no viajan: dejan la URL legible y compartible, que es
  // media función de un listado filtrable.
  for (const key of Object.keys(next)) {
    if (next[key] === '' || (key === 'sort' && next[key] === 'legal_name') ||
        (key === 'direction' && next[key] === 'asc')) {
      delete next[key]
    }
  }

  router.get('/carriers', next, { preserveState: true, preserveScroll: true, replace: true })
}

export default function CarriersIndex({ carriers, filters, facets, scope, can }: Props) {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState(filters.search)
  const first = useRef(true)

  // Búsqueda con retardo: una petición por pulsación llenaría el servidor de
  // consultas que nadie va a leer, porque la siguiente letra las invalida.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }

    const timer = setTimeout(() => navigate(filters, { search }), 300)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const { meta } = carriers
  const from = meta.total === 0 ? 0 : (meta.currentPage - 1) * meta.perPage + 1
  const to = Math.min(meta.currentPage * meta.perPage, meta.total)
  const filtered = filters.search !== '' || filters.onboarding !== '' || filters.fmcsa !== ''

  return (
    <AppLayout
      title={t('carriers.index.title')}
      description={t('carriers.index.subtitle')}
      crumbs={[{ label: t('carriers.index.title') }]}
      actions={
        can.create ? (
          <Link
            href="/carriers/create"
            className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700"
          >
            {t('carriers.index.add')}
          </Link>
        ) : null
      }
    >
      {/* El ámbito, dicho en palabras. Un despachador tiene derecho a saber que
          está viendo su cartera y no la empresa entera — si no, un recuento bajo
          parece un error del sistema. */}
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-steel-600">
        {t(`carriers.scope.${scope}`)}
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="carrier-search" className="sr-only">
            {t('carriers.index.searchLabel')}
          </label>
          <input
            id="carrier-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('carriers.index.searchPlaceholder')}
            className="w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-steel-500 focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
        </div>

        <Filter
          label={t('carriers.filters.onboarding')}
          value={filters.onboarding}
          options={ONBOARDING_ORDER.map((v) => ({
            value: v,
            label: `${t(`nav.status.onboarding.${camel(v)}`)}${facets[v] ? ` (${facets[v]})` : ''}`,
          }))}
          onChange={(value) => navigate(filters, { onboarding: value })}
        />

        <Filter
          label={t('carriers.filters.fmcsa')}
          value={filters.fmcsa}
          options={FMCSA_ORDER.map((v) => ({
            value: v,
            label: t(`nav.status.verification.${camel(v)}`),
          }))}
          onChange={(value) => navigate(filters, { fmcsa: value })}
        />

        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              router.get('/carriers', {}, { preserveScroll: true, replace: true })
            }}
            className="rounded border border-steel-300 px-3 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
          >
            {t('carriers.filters.clear')}
          </button>
        ) : null}
      </div>

      {carriers.data.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-steel-300 bg-white p-10 text-center">
          <p className="font-display text-lg font-bold text-navy-700">
            {t(filtered ? 'carriers.index.noResults' : 'carriers.index.empty')}
          </p>
          <p className="mt-1 text-sm text-steel-700">
            {t(filtered ? 'carriers.index.noResultsHint' : 'carriers.index.emptyHint')}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded border border-steel-200 bg-white">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-steel-200 bg-navy-50 text-left">
                  <Th sortKey="legal_name" filters={filters}>{t('carriers.columns.carrier')}</Th>
                  <Th sortKey="dot_number" filters={filters}>{t('carriers.columns.usdot')}</Th>
                  <Th>{t('carriers.columns.location')}</Th>
                  <Th>{t('carriers.columns.contact')}</Th>
                  <Th sortKey="onboarding_status" filters={filters}>{t('carriers.columns.onboarding')}</Th>
                  <Th sortKey="fmcsa_status" filters={filters}>{t('carriers.columns.fmcsa')}</Th>
                  <Th sortKey="last_activity_at" filters={filters}>{t('carriers.columns.lastActivity')}</Th>
                </tr>
              </thead>
              <tbody>
                {carriers.data.map((c) => (
                  <tr key={c.id} className="border-b border-steel-100 last:border-0 hover:bg-navy-50/60">
                    <td className="px-3 py-3">
                      <Link
                        href={`/carriers/${c.id}`}
                        className="font-medium text-navy-700 underline-offset-2 hover:underline"
                      >
                        {c.legalName}
                      </Link>
                      {c.dba ? <span className="block text-xs text-steel-600">{c.dba}</span> : null}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {c.dotNumber}
                      {c.mcNumber ? (
                        <span className="block text-xs text-steel-600">MC {c.mcNumber}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-steel-700">
                      {c.city ? `${c.city}, ${c.state ?? ''}`.trim() : '—'}
                    </td>
                    <td className="px-3 py-3">
                      {c.contact}
                      <span className="block text-xs text-steel-600">{c.email}</span>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge family="onboarding" value={c.onboardingStatus} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge family="verification" value={c.fmcsaStatus} />
                    </td>
                    <td className="px-3 py-3 text-steel-700">
                      {c.lastActivityAt
                        ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
                            dateStyle: 'medium',
                          }).format(new Date(c.lastActivityAt))
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-steel-700">
            <p>{t('carriers.index.showing', { from, to, total: meta.total })}</p>

            {meta.lastPage > 1 ? (
              <div className="flex gap-1">
                {Array.from({ length: meta.lastPage }, (_, i) => i + 1).map((n) => (
                  <Link
                    key={n}
                    href={`/carriers?${new URLSearchParams({ ...cleanFilters(filters), page: String(n) })}`}
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

function cleanFilters(filters: Props['filters']): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''))
}

function camel(value: string): string {
  return value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const { t } = useI18n()

  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-steel-700">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-steel-300 bg-white px-3 py-2 text-sm text-carbon outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
      >
        <option value="">{t('carriers.filters.all')}</option>
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
  children,
  sortKey,
  filters,
}: {
  children: React.ReactNode
  sortKey?: string
  filters?: Props['filters']
}) {
  if (!sortKey || !filters) {
    return <th scope="col" className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-steel-700">{children}</th>
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
