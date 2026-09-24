import { Link, router } from '@inertiajs/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EmptyState } from '@/components/App/EmptyState'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface VendorRow {
  id: string
  companyName: string
  vendorType: string
  phone: string | null
  email: string | null
  city: string | null
  state: string | null
  paymentTermsDays: number
  status: string
  carrierCount: number
  unitCount: number
}

interface Filters {
  search: string
  type: string
  status: string
  carrier: string
  sort: string
  direction: string
}

interface Props {
  vendors: {
    data: VendorRow[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }
  filters: Filters
  types: string[]
  carriers: { id: string; name: string }[]
  scope: string
  can: { create: boolean }
}

const TONO: Record<string, string> = {
  active: 'bg-success-50 text-success-700 ring-success-500/40',
  inactive: 'bg-steel-100 text-steel-800 ring-steel-300',
  archived: 'bg-steel-100 text-steel-800 ring-steel-300',
}

function ir(filters: Filters, patch: Partial<Filters>) {
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

  router.get('/vendors', next, { preserveState: true, preserveScroll: true, replace: true })
}

/**
 * La lista de proveedores.
 *
 * Dos columnas que no están en ningún otro listado y son el motivo de la
 * pantalla: a cuántos transportistas sirve y cuántas unidades le arrienda. La
 * segunda es la que el texto libre nunca pudo contestar.
 */
export default function VendorsIndex({ vendors, filters, types, carriers, scope, can }: Props) {
  const { t } = useI18n()
  const [search, setSearch] = useState(filters.search)
  const primera = useRef(true)

  // Con retardo, igual que en clientes y transportistas: una petición por
  // pulsación llena el servidor de consultas que la siguiente letra invalida.
  useEffect(() => {
    if (primera.current) {
      primera.current = false

      return
    }

    const reloj = setTimeout(() => ir(filters, { search }), 300)

    return () => clearTimeout(reloj)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const { meta } = vendors
  const desde = meta.total === 0 ? 0 : (meta.currentPage - 1) * meta.perPage + 1
  const hasta = Math.min(meta.currentPage * meta.perPage, meta.total)
  const filtered =
    filters.search !== '' || filters.type !== '' || filters.status !== '' || filters.carrier !== ''

  return (
    <AppLayout
      title={t('vendors.index.title')}
      description={t('vendors.index.subtitle')}
      crumbs={[{ label: t('vendors.index.title') }]}
      actions={
        can.create ? (
          <Link
            href="/vendors/create"
            className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700"
          >
            {t('vendors.index.add')}
          </Link>
        ) : null
      }
    >
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-steel-600">
        {t(`vendors.scope.${scope}`)}
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="vendor-search" className="sr-only">
            {t('vendors.index.searchLabel')}
          </label>
          <input
            id="vendor-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('vendors.index.searchPlaceholder')}
            className="w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-steel-500 focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
        </div>

        <Desplegable
          label={t('vendors.filters.type')}
          value={filters.type}
          onChange={(v) => ir(filters, { type: v })}
          todos={t('vendors.filters.all')}
          opciones={types.map((v) => ({ value: v, label: t(`vendors.type.${v}`) }))}
        />

        <Desplegable
          label={t('vendors.filters.status')}
          value={filters.status}
          onChange={(v) => ir(filters, { status: v })}
          todos={t('vendors.filters.all')}
          opciones={['active', 'inactive', 'archived'].map((v) => ({
            value: v,
            label: t(`vendors.status.${v}`),
          }))}
        />

        {/* El filtro por transportista solo aparece cuando hay más de uno
            entre los que elegir: con uno solo, elegirlo no recorta nada. */}
        {carriers.length > 1 ? (
          <Desplegable
            label={t('vendors.filters.carrier')}
            value={filters.carrier}
            onChange={(v) => ir(filters, { carrier: v })}
            todos={t('vendors.filters.all')}
            opciones={carriers.map((c) => ({ value: c.id, label: c.name }))}
          />
        ) : null}

        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              router.get('/vendors', {}, { preserveScroll: true, replace: true })
            }}
            className="rounded border border-steel-300 px-3 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
          >
            {t('vendors.filters.clear')}
          </button>
        ) : null}
      </div>

      {vendors.data.length === 0 ? (
        <EmptyState ns="vendors" filtered={filtered} scope={scope} canCreate={can.create} />
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded border border-steel-200 bg-white">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-steel-200 bg-navy-50 text-left">
                  <Th sortKey="company_name" filters={filters}>{t('vendors.index.columns.name')}</Th>
                  <Th sortKey="vendor_type" filters={filters}>{t('vendors.index.columns.type')}</Th>
                  <Th>{t('vendors.index.columns.contact')}</Th>
                  <Th sortKey="city" filters={filters}>{t('vendors.index.columns.place')}</Th>
                  <Th sortKey="payment_terms_days" filters={filters}>{t('vendors.index.columns.terms')}</Th>
                  <Th>{t('vendors.index.columns.serves')}</Th>
                  <Th sortKey="status" filters={filters}>{t('vendors.index.columns.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {vendors.data.map((v) => (
                  <tr key={v.id} className="border-b border-steel-100 last:border-0 hover:bg-navy-50/60">
                    <td className="px-3 py-3">
                      <Link
                        href={`/vendors/${v.id}`}
                        className="font-medium text-navy-700 underline-offset-2 hover:underline"
                      >
                        {v.companyName}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-steel-700">{t(`vendors.type.${v.vendorType}`)}</td>
                    <td className="px-3 py-3">
                      {v.email === null ? null : (
                        <span className="block truncate text-xs text-steel-600">{v.email}</span>
                      )}
                      {v.phone ?? (v.email === null ? '—' : '')}
                    </td>
                    <td className="px-3 py-3 text-steel-700">
                      {v.city === null ? '—' : `${v.city}, ${v.state ?? ''}`.replace(/,\s*$/, '')}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-steel-700">
                      {t('vendors.detail.termsDays', { n: v.paymentTermsDays })}
                    </td>
                    <td className="px-3 py-3 text-steel-700">
                      <span className="block">
                        {t('vendors.index.carrierCount', { n: v.carrierCount })}
                      </span>
                      {/* Lo que le arrienda. Es la pregunta que el nombre
                          tecleado a mano nunca pudo contestar. */}
                      <span className="block text-xs text-steel-600">
                        {v.unitCount === 0
                          ? t('vendors.index.noUnits')
                          : t('vendors.index.unitCount', { n: v.unitCount })}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          TONO[v.status] ?? TONO.inactive
                        }`}
                      >
                        {t(`vendors.status.${v.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-steel-700">
            <p>{t('vendors.index.showing', { from: desde, to: hasta, total: meta.total })}</p>

            {meta.lastPage > 1 ? (
              <div className="flex gap-1">
                {Array.from({ length: meta.lastPage }, (_, i) => i + 1).map((n) => (
                  <Link
                    key={n}
                    href={`/vendors?${new URLSearchParams({
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

function Desplegable({
  label,
  value,
  onChange,
  todos,
  opciones,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  todos: string
  opciones: { value: string; label: string }[]
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-steel-700">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-steel-300 bg-white px-3 py-2 text-sm text-carbon outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
      >
        <option value="">{todos}</option>
        {opciones.map((o) => (
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
  children: ReactNode
  sortKey?: string
  filters?: Filters
}) {
  if (sortKey === undefined || filters === undefined) {
    return (
      <th scope="col" className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-steel-700">
        {children}
      </th>
    )
  }

  const activa = filters.sort === sortKey
  const direccion = activa && filters.direction === 'asc' ? 'desc' : 'asc'

  return (
    <th
      scope="col"
      aria-sort={activa ? (filters.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-steel-700"
    >
      <button
        type="button"
        onClick={() => ir(filters, { sort: sortKey, direction: direccion })}
        className="inline-flex items-center gap-1 uppercase transition hover:text-navy-700"
      >
        {children}
        <span aria-hidden="true">{activa ? (filters.direction === 'asc' ? '↑' : '↓') : ''}</span>
      </button>
    </th>
  )
}
