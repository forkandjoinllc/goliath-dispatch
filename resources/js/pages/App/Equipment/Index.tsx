import { Link, router } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Unit {
  id: string
  unitNumber: string
  vin: string | null
  carrier: string | null
  year: number | null
  make: string | null
  model: string | null
  plateNumber: string | null
  plateState: string | null
  status: string
  nextInspectionDueAt: string | null
  registrationExpiresAt: string | null
  expiries: { inspection: string | null; registration: string | null }
}

interface Props {
  type: 'trucks' | 'trailers'
  units: {
    data: Unit[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }
  filters: { search: string; status: string; expiring: string; sort: string; direction: string }
  scope: string
  facets: Record<string, number>
  can: { create: boolean }
}

const STATUS_TONE: Record<string, string> = {
  active: 'bg-success-50 text-success-700 ring-success-500/40',
  pending_verification: 'bg-navy-100 text-navy-800 ring-navy-500/30',
  out_of_service: 'bg-danger-50 text-danger-700 ring-danger-500/40',
  archived: 'bg-steel-100 text-steel-600 ring-steel-300',
}

function navigate(type: string, filters: Props['filters'], patch: Partial<Props['filters']>) {
  const next: Record<string, string> = { ...filters, ...patch }

  for (const key of Object.keys(next)) {
    if (
      next[key] === '' ||
      (key === 'sort' && next[key] === 'unit_number') ||
      (key === 'direction' && next[key] === 'asc')
    ) {
      delete next[key]
    }
  }

  router.get(`/equipment/${type}`, next, { preserveState: true, preserveScroll: true, replace: true })
}

export default function EquipmentIndex({ type, units, filters, scope, facets, can }: Props) {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState(filters.search)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }

    const timer = setTimeout(() => navigate(type, filters, { search }), 300)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const { meta } = units
  const from = meta.total === 0 ? 0 : (meta.currentPage - 1) * meta.perPage + 1
  const to = Math.min(meta.currentPage * meta.perPage, meta.total)
  const filtered = filters.search !== '' || filters.status !== '' || filters.expiring !== ''

  const day = (value: string | null): string =>
    value
      ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { dateStyle: 'medium' }).format(
          new Date(value),
        )
      : '—'

  return (
    <AppLayout
      title={t(type === 'trucks' ? 'equipment.index.trucksTitle' : 'equipment.index.trailersTitle')}
      description={t('equipment.index.subtitle')}
      crumbs={[
        { label: t(type === 'trucks' ? 'equipment.index.trucksTitle' : 'equipment.index.trailersTitle') },
      ]}
      actions={
        can.create ? (
          <Link
            href={`/equipment/${type}/create`}
            className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700"
          >
            {t(type === 'trucks' ? 'equipment.index.addTruck' : 'equipment.index.addTrailer')}
          </Link>
        ) : null
      }
    >
      {/* Pestañas. Camiones y remolques son el mismo dominio y se miran juntos:
          partirlos en dos entradas del menú obligaría a volver atrás cada vez. */}
      <div className="flex gap-1 border-b border-steel-200">
        {(['trucks', 'trailers'] as const).map((tab) => (
          <Link
            key={tab}
            href={`/equipment/${tab}`}
            aria-current={tab === type ? 'page' : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === type
                ? 'border-safety-600 text-navy-800'
                : 'border-transparent text-steel-600 hover:text-navy-700'
            }`}
          >
            {t(tab === 'trucks' ? 'equipment.index.trucksTab' : 'equipment.index.trailersTab')}
          </Link>
        ))}
      </div>

      <p className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-steel-600">
        {t(`equipment.scope.${scope}`)}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip
          label={t('equipment.filters.all')}
          count={facets.all ?? 0}
          active={filters.status === '' && filters.expiring === ''}
          onClick={() => navigate(type, filters, { status: '', expiring: '' })}
        />
        {['active', 'pending_verification', 'out_of_service'].map((s) => (
          <Chip
            key={s}
            label={t(`equipment.status.${s}`)}
            count={facets[s] ?? 0}
            active={filters.status === s}
            onClick={() =>
              navigate(type, filters, { status: filters.status === s ? '' : s, expiring: '' })
            }
          />
        ))}
        <Chip
          label={t('equipment.filters.expiring')}
          count={facets.expiring ?? 0}
          active={filters.expiring === '1'}
          warn
          onClick={() =>
            navigate(type, filters, { expiring: filters.expiring === '1' ? '' : '1', status: '' })
          }
        />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="equipment-search" className="sr-only">
            {t('equipment.index.searchLabel')}
          </label>
          <input
            id="equipment-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('equipment.index.searchPlaceholder')}
            className="w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-steel-500 focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
        </div>

        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              router.get(`/equipment/${type}`, {}, { preserveScroll: true, replace: true })
            }}
            className="rounded border border-steel-300 px-3 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
          >
            {t('equipment.filters.clear')}
          </button>
        ) : null}
      </div>

      {units.data.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-steel-300 bg-white p-10 text-center">
          <p className="font-display text-lg font-bold text-navy-700">
            {t(filtered ? 'equipment.index.noResults' : 'equipment.index.empty')}
          </p>
          <p className="mt-1 text-sm text-steel-700">
            {t(filtered ? 'equipment.index.noResultsHint' : 'equipment.index.emptyHint')}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded border border-steel-200 bg-white">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-steel-200 bg-navy-50 text-left">
                  <Th type={type} sortKey="unit_number" filters={filters}>
                    {t('equipment.columns.unit')}
                  </Th>
                  <Th>{t('equipment.columns.carrier')}</Th>
                  <Th type={type} sortKey="year" filters={filters}>
                    {t('equipment.columns.vehicle')}
                  </Th>
                  <Th>{t('equipment.columns.plate')}</Th>
                  <Th type={type} sortKey="next_inspection_due_at" filters={filters}>
                    {t('equipment.columns.inspection')}
                  </Th>
                  <Th type={type} sortKey="registration_expires_at" filters={filters}>
                    {t('equipment.columns.registration')}
                  </Th>
                  <Th type={type} sortKey="status" filters={filters}>
                    {t('equipment.columns.status')}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {units.data.map((u) => (
                  <tr key={u.id} className="border-b border-steel-100 last:border-0 hover:bg-navy-50/60">
                    <td className="px-3 py-3">
                      <Link
                        href={`/equipment/${type}/${u.id}`}
                        className="font-medium tabular-nums text-navy-700 underline-offset-2 hover:underline"
                      >
                        {u.unitNumber}
                      </Link>
                      {u.vin ? (
                        <span className="block truncate text-xs tabular-nums text-steel-600">{u.vin}</span>
                      ) : null}
                    </td>
                    <td className="max-w-40 truncate px-3 py-3 text-steel-700">{u.carrier ?? '—'}</td>
                    <td className="px-3 py-3 text-steel-700">
                      {[u.year, u.make, u.model].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-steel-700">
                      {u.plateNumber ? `${u.plateNumber}${u.plateState ? ` · ${u.plateState}` : ''}` : '—'}
                    </td>
                    <ExpiryCell date={day(u.nextInspectionDueAt)} flag={u.expiries.inspection} />
                    <ExpiryCell date={day(u.registrationExpiresAt)} flag={u.expiries.registration} />
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          STATUS_TONE[u.status] ?? STATUS_TONE.archived
                        }`}
                      >
                        {t(`equipment.status.${u.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-steel-700">
            <p>{t('equipment.index.showing', { from, to, total: meta.total })}</p>

            {meta.lastPage > 1 ? (
              <div className="flex gap-1">
                {Array.from({ length: meta.lastPage }, (_, i) => i + 1).map((n) => (
                  <Link
                    key={n}
                    href={`/equipment/${type}?${new URLSearchParams({
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

function ExpiryCell({ date, flag }: { date: string; flag: string | null }) {
  const { t } = useI18n()

  return (
    <td className="whitespace-nowrap px-3 py-3">
      <span className={flag === 'expired' ? 'font-medium text-danger-700' : 'text-steel-700'}>
        {date}
      </span>
      {flag ? (
        <span
          className={`block text-xs font-medium ${
            flag === 'expired' ? 'text-danger-700' : 'text-safety-700'
          }`}
        >
          {t(flag === 'expired' ? 'equipment.detail.expired' : 'equipment.detail.expiringSoon')}
        </span>
      ) : null}
    </td>
  )
}

function Chip({
  label, count, active, onClick, warn,
}: { label: string; count: number; active: boolean; onClick: () => void; warn?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? warn
            ? 'border-safety-600 bg-safety-600 text-white'
            : 'border-navy-700 bg-navy-700 text-white'
          : warn && count > 0
            ? 'border-safety-400 bg-safety-50 text-safety-800 hover:bg-safety-100'
            : 'border-steel-300 bg-white text-steel-800 hover:bg-navy-50'
      }`}
    >
      {label}
      <span className={`ml-1.5 tabular-nums ${active ? 'opacity-80' : 'text-steel-500'}`}>{count}</span>
    </button>
  )
}

function Th({
  children, sortKey, filters, type,
}: {
  children: React.ReactNode
  sortKey?: string
  filters?: Props['filters']
  type?: string
}) {
  if (!sortKey || !filters || !type) {
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
        onClick={() => navigate(type, filters, { sort: sortKey, direction })}
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
