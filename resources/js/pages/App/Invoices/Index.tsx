import { Link, router } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { navegar, hayFiltros } from '@/lib/filters'
import { formatCents } from '@/lib/format'
import { Pager, type PageMeta } from '@/components/App/Pager'
import { useI18n } from '@/lib/i18n'

interface InvoiceRow {
  id: string
  number: string
  carrierId: string
  carrierName: string | null
  status: string
  totalCents: number
  amountPaidCents: number
  balanceCents: number
  issueDate: string | null
  dueDate: string | null
}

interface Props {
  invoices: {
    data: InvoiceRow[]
    meta: PageMeta
  }
  /**
   * TODOS los filtros que aplicó el servidor, `overdue` incluido.
   *
   * Faltaba, y por eso se perdía: cada control reconstruía la consulta con la
   * lista de filtros que tenía delante. Ver `resources/js/lib/filters.ts`.
   */
  filters: { search: string; status: string; overdue: string }
  statuses: string[]
  totals: { totalCents: number; outstandingCents: number }
  can: { create: boolean }
}

export default function InvoicesIndex({ invoices, filters, statuses, totals, can }: Props) {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState(filters.search)
  const primera = useRef(true)

  useEffect(() => {
    if (primera.current) {
      primera.current = false

      return
    }

    const id = setTimeout(() => navegar('/invoices', filters, { search }), 300)

    return () => clearTimeout(id)
  }, [search, filters.status])

  return (
    <AppLayout
      title={t('invoices.index.title')}
      description={t('invoices.index.subtitle')}
      crumbs={[{ label: t('invoices.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        {/* Los totales son de TODO el filtro, no de la página. Una suma que
            cambia al pasar de página no es una suma. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile label={t('invoices.index.billed')} value={formatCents(totals.totalCents, locale)} />
          <Tile label={t('invoices.index.outstanding')} value={formatCents(totals.outstandingCents, locale)} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('invoices.index.search')}</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('invoices.index.searchPlaceholder')}
              className="rounded border border-steel-300 px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('invoices.index.status')}</span>
            <select
              value={filters.status}
              onChange={(e) => navegar('/invoices', filters, { status: e.target.value })}
              className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
            >
              <option value="">{t('invoices.index.anyStatus')}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {t(`invoices.status.${s}`)}
                </option>
              ))}
            </select>
          </label>

          {/* El filtro que no tiene control propio: se llega a él desde la
              tarjeta «Facturas vencidas» del panel. Sin decirlo, quien aterriza
              aquí ve una lista corta con dos sumas de dinero encima y no sabe
              que está recortada. Es el mismo chip que el listado de cargas ya
              pinta para `uninvoiced`. */}
          {filters.overdue === '1' ? (
            <span className="rounded border border-navy-300 bg-navy-50 px-3 py-2 text-sm text-navy-800">
              {t('invoices.index.overdue')}
            </span>
          ) : null}

          {hayFiltros(filters) ? (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                router.get('/invoices', {}, { preserveScroll: true, replace: true })
              }}
              className="rounded border border-steel-300 px-3 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
            >
              {t('invoices.index.clear')}
            </button>
          ) : null}

          {can.create ? (
            <Link
              href="/invoices/create"
              className="ml-auto rounded bg-safety-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700"
            >
              {t('invoices.index.create')}
            </Link>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded border border-steel-200 bg-white">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-steel-50 text-left text-xs uppercase tracking-wide text-steel-600">
              <tr>
                <th className="px-4 py-2.5">{t('invoices.index.number')}</th>
                <th className="px-4 py-2.5">{t('invoices.index.carrier')}</th>
                <th className="px-4 py-2.5">{t('invoices.index.status')}</th>
                <th className="px-4 py-2.5">{t('invoices.index.due')}</th>
                <th className="px-4 py-2.5 text-right">{t('invoices.index.total')}</th>
                <th className="px-4 py-2.5 text-right">{t('invoices.index.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-steel-600">
                    {t('invoices.index.empty')}
                  </td>
                </tr>
              ) : null}

              {invoices.data.map((i) => (
                <tr key={i.id} className="border-t border-steel-100">
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={`/invoices/${i.id}`} className="text-navy-700 underline">
                      {i.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{i.carrierName ?? '—'}</td>
                  <td className="px-4 py-2.5">{t(`invoices.status.${i.status}`)}</td>
                  <td className="px-4 py-2.5">{i.dueDate ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(i.totalCents, locale)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(i.balanceCents, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pager meta={invoices.meta} path="/invoices" params={{ ...filters }} />
      </div>
    </AppLayout>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-steel-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-steel-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-carbon">{value}</p>
    </div>
  )
}
