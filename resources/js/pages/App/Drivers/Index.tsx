import { Link, router } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface DriverRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  status: string
  verificationStatus: string
  cdlClass: string | null
  licenseState: string | null
  licenseLast4: string | null
  licenseExpiresAt: string | null
  medicalCardExpiresAt: string | null
  expiries: { license: string | null; medical: string | null }
}

interface Props {
  drivers: {
    data: DriverRow[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }
  filters: { search: string; status: string; expiring: string; sort: string; direction: string }
  scope: string
  facets: Record<string, number>
  can: { create: boolean }
}

const STATUS_TONE: Record<string, string> = {
  available: 'bg-success-50 text-success-700 ring-success-500/40',
  on_load: 'bg-navy-100 text-navy-800 ring-navy-500/30',
  off_duty: 'bg-steel-100 text-steel-800 ring-steel-300',
  inactive: 'bg-steel-100 text-steel-600 ring-steel-300',
}

const VERIFICATION_TONE: Record<string, string> = {
  verified: 'bg-success-50 text-success-700 ring-success-500/40',
  not_started: 'bg-steel-100 text-steel-700 ring-steel-300',
  pending: 'bg-navy-100 text-navy-800 ring-navy-500/30',
  mismatch: 'bg-safety-100 text-safety-800 ring-safety-500/40',
  failed: 'bg-danger-50 text-danger-700 ring-danger-500/40',
  manually_overridden: 'bg-safety-100 text-safety-800 ring-safety-500/40',
  expired: 'bg-danger-50 text-danger-700 ring-danger-500/40',
}

function navigate(filters: Props['filters'], patch: Partial<Props['filters']>) {
  const next: Record<string, string> = { ...filters, ...patch }

  for (const key of Object.keys(next)) {
    if (
      next[key] === '' ||
      (key === 'sort' && next[key] === 'last_name') ||
      (key === 'direction' && next[key] === 'asc')
    ) {
      delete next[key]
    }
  }

  router.get('/drivers', next, { preserveState: true, preserveScroll: true, replace: true })
}

export default function DriversIndex({ drivers, filters, scope, facets, can }: Props) {
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

  const { meta } = drivers
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
      title={t('drivers.index.title')}
      description={t('drivers.index.subtitle')}
      crumbs={[{ label: t('drivers.index.title') }]}
      actions={
        can.create ? (
          <Link
            href="/drivers/create"
            className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700"
          >
            {t('drivers.index.add')}
          </Link>
        ) : null
      }
    >
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-steel-600">
        {t(`drivers.scope.${scope}`)}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Chip
          label={t('drivers.filters.all')}
          count={facets.all ?? 0}
          active={filters.status === '' && filters.expiring === ''}
          onClick={() => navigate(filters, { status: '', expiring: '' })}
        />
        {['available', 'on_load', 'off_duty', 'inactive'].map((s) => (
          <Chip
            key={s}
            label={t(`drivers.status.${s}`)}
            count={facets[s] ?? 0}
            active={filters.status === s}
            onClick={() => navigate(filters, { status: filters.status === s ? '' : s, expiring: '' })}
          />
        ))}
        {/* El atajo que de verdad se usa: quién tiene el papeleo a punto de
            caducar. Es la pregunta que evita que una carga se caiga el jueves. */}
        <Chip
          label={t('drivers.filters.expiring')}
          count={facets.expiring ?? 0}
          active={filters.expiring === '1'}
          warn
          onClick={() => navigate(filters, { expiring: filters.expiring === '1' ? '' : '1', status: '' })}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="driver-search" className="sr-only">
            {t('drivers.index.searchLabel')}
          </label>
          <input
            id="driver-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('drivers.index.searchPlaceholder')}
            className="w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-steel-500 focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
        </div>

        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              router.get('/drivers', {}, { preserveScroll: true, replace: true })
            }}
            className="rounded border border-steel-300 px-3 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
          >
            {t('drivers.filters.clear')}
          </button>
        ) : null}
      </div>

      {drivers.data.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-steel-300 bg-white p-10 text-center">
          <p className="font-display text-lg font-bold text-navy-700">
            {t(filtered ? 'drivers.index.noResults' : 'drivers.index.empty')}
          </p>
          <p className="mt-1 text-sm text-steel-700">
            {t(filtered ? 'drivers.index.noResultsHint' : 'drivers.index.emptyHint')}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded border border-steel-200 bg-white">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-steel-200 bg-navy-50 text-left">
                  <Th sortKey="last_name" filters={filters}>{t('drivers.columns.driver')}</Th>
                  <Th>{t('drivers.columns.contact')}</Th>
                  <Th sortKey="license_expires_at" filters={filters}>{t('drivers.columns.licence')}</Th>
                  <Th sortKey="medical_card_expires_at" filters={filters}>{t('drivers.columns.medical')}</Th>
                  <Th>{t('drivers.columns.verification')}</Th>
                  <Th sortKey="status" filters={filters}>{t('drivers.columns.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {drivers.data.map((d) => (
                  <tr key={d.id} className="border-b border-steel-100 last:border-0 hover:bg-navy-50/60">
                    <td className="px-3 py-3">
                      <Link
                        href={`/drivers/${d.id}`}
                        className="font-medium text-navy-700 underline-offset-2 hover:underline"
                      >
                        {d.name}
                      </Link>
                      {d.licenseLast4 ? (
                        <span className="block text-xs tabular-nums text-steel-600">
                          {d.licenseState ? `${d.licenseState} ` : ''}
                          {t('drivers.detail.licenceMasked', { last4: d.licenseLast4 })}
                          {d.cdlClass ? ` · ${d.cdlClass}` : ''}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-steel-700">
                      {d.phone ?? '—'}
                      {d.email ? (
                        <span className="block truncate text-xs text-steel-600">{d.email}</span>
                      ) : null}
                    </td>
                    <ExpiryCell date={day(d.licenseExpiresAt)} flag={d.expiries.license} />
                    <ExpiryCell date={day(d.medicalCardExpiresAt)} flag={d.expiries.medical} />
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          VERIFICATION_TONE[d.verificationStatus] ?? VERIFICATION_TONE.not_started
                        }`}
                      >
                        {t(`drivers.verification.${d.verificationStatus}`)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          STATUS_TONE[d.status] ?? STATUS_TONE.inactive
                        }`}
                      >
                        {t(`drivers.status.${d.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-steel-700">
            <p>{t('drivers.index.showing', { from, to, total: meta.total })}</p>

            {meta.lastPage > 1 ? (
              <div className="flex gap-1">
                {Array.from({ length: meta.lastPage }, (_, i) => i + 1).map((n) => (
                  <Link
                    key={n}
                    href={`/drivers?${new URLSearchParams({
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

/**
 * Una fecha de vencimiento con su aviso.
 *
 * El color lo decide el SERVIDOR (`expiries`), no un cálculo aquí. Con la fecha
 * a pelo, el navegador de alguien en otra zona horaria pintaría en rojo una
 * licencia que todavía vale, o al revés.
 */
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
          {t(flag === 'expired' ? 'drivers.detail.expired' : 'drivers.detail.expiringSoon')}
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
