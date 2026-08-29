import { router } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

interface CarrierRow {
  id: string
  name: string
  loads: number
  grossCents: number
  feeCents: number
  netCents: number
  marginCents: number
}

interface CustomerRow {
  id: string | null
  name: string | null
  loads: number
  chargeCents: number
  feeCents: number
  marginCents: number
}

interface CommissionRow {
  id: string
  name: string
  totalCents: number
  paidCents: number
  owedCents: number
}

interface Props {
  period: { from: string; to: string }
  summary: { feeCents: number; marginCents: number; loads: number; outstandingCents: number }
  byCarrier: CarrierRow[]
  byCustomer: CustomerRow[]
  aging: Record<string, { amountCents: number; count: number }>
  expensesByTreatment: Record<string, number>
  commissionsByDispatcher: CommissionRow[]
  loadsByStatus: Record<string, number>
  exportables: string[]
  can: { export: boolean }
}

const TRAMOS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus']

export default function ReportsIndex({
  period, summary, byCarrier, byCustomer, aging,
  expensesByTreatment, commissionsByDispatcher, loadsByStatus, can,
}: Props) {
  const { t, locale } = useI18n()

  const cambiar = (patch: Partial<Props['period']>) =>
    router.get('/reports', { ...period, ...patch }, { preserveState: true, replace: true })

  const exportar = (table: string) => {
    // Descarga directa: no es una navegación de Inertia.
    window.location.href = `/reports/export?table=${table}&from=${period.from}&to=${period.to}`
  }

  return (
    <AppLayout
      title={t('reports.index.title')}
      description={t('reports.index.subtitle')}
      crumbs={[{ label: t('reports.index.title') }]}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('reports.index.from')}</span>
            <input type="date" value={period.from} onChange={(e) => cambiar({ from: e.target.value })} className={CAMPO} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('reports.index.to')}</span>
            <input type="date" value={period.to} onChange={(e) => cambiar({ to: e.target.value })} className={CAMPO} />
          </label>
        </div>

        {/* Se dice de qué habla el informe. «Margen» sin decir sobre qué es un
            número que cada cual interpreta a su manera. */}
        <p className="rounded border-l-4 border-safety-500 bg-navy-50 p-3 text-sm text-carbon">
          {t('reports.index.basis')}
        </p>

        <div className="grid gap-3 sm:grid-cols-4">
          <Tile label={t('reports.summary.fee')} value={formatCents(summary.feeCents, locale)} />
          <Tile label={t('reports.summary.margin')} value={formatCents(summary.marginCents, locale)} />
          <Tile label={t('reports.summary.loads')} value={String(summary.loads)} />
          <Tile label={t('reports.summary.outstanding')} value={formatCents(summary.outstandingCents, locale)} />
        </div>

        <Seccion titulo={t('reports.aging.title')} nota={t('reports.aging.note')}>
          <div className="grid gap-3 sm:grid-cols-5">
            {TRAMOS.map((k) => (
              <div key={k} className="rounded border border-steel-200 p-3">
                <p className="text-xs uppercase tracking-wide text-steel-600">{t(`reports.aging.${k}`)}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-carbon">
                  {formatCents(aging[k]?.amountCents ?? 0, locale)}
                </p>
                <p className="text-xs text-steel-600">
                  {t('reports.aging.invoices', { n: String(aging[k]?.count ?? 0) })}
                </p>
              </div>
            ))}
          </div>
        </Seccion>

        <Seccion
          titulo={t('reports.carriers.title')}
          onExport={can.export ? () => exportar('carriers') : undefined}
        >
          <Tabla
            head={[
              t('reports.carriers.carrier'), t('reports.carriers.loads'),
              t('reports.carriers.gross'), t('reports.carriers.fee'),
              t('reports.carriers.net'), t('reports.carriers.margin'),
            ]}
            rows={byCarrier.map((r) => [
              r.name, String(r.loads),
              formatCents(r.grossCents, locale), formatCents(r.feeCents, locale),
              formatCents(r.netCents, locale), formatCents(r.marginCents, locale),
            ])}
            empty={t('reports.index.empty')}
          />
        </Seccion>

        <Seccion
          titulo={t('reports.customers.title')}
          onExport={can.export ? () => exportar('customers') : undefined}
        >
          <Tabla
            head={[
              t('reports.customers.customer'), t('reports.carriers.loads'),
              t('reports.customers.charge'), t('reports.carriers.fee'), t('reports.carriers.margin'),
            ]}
            rows={byCustomer.map((r) => [
              r.name ?? t('reports.customers.none'), String(r.loads),
              formatCents(r.chargeCents, locale), formatCents(r.feeCents, locale),
              formatCents(r.marginCents, locale),
            ])}
            empty={t('reports.index.empty')}
          />
        </Seccion>

        {commissionsByDispatcher.length > 0 ? (
          <Seccion
            titulo={t('reports.commissions.title')}
            onExport={can.export ? () => exportar('commissions') : undefined}
          >
            <Tabla
              head={[
                t('reports.commissions.dispatcher'), t('reports.commissions.accrued'),
                t('reports.commissions.paid'), t('reports.commissions.owed'),
              ]}
              rows={commissionsByDispatcher.map((r) => [
                r.name,
                formatCents(r.totalCents, locale),
                formatCents(r.paidCents, locale),
                formatCents(r.owedCents, locale),
              ])}
              empty={t('reports.index.empty')}
            />
          </Seccion>
        ) : null}

        <div className="grid gap-6 sm:grid-cols-2">
          <Seccion titulo={t('reports.expenses.title')}>
            <Lista
              items={Object.entries(expensesByTreatment).map(([k, v]) => [
                t(`expenses.treatment.${k}`), formatCents(v, locale),
              ])}
              empty={t('reports.index.empty')}
            />
          </Seccion>

          <Seccion titulo={t('reports.loads.title')}>
            <Lista
              items={Object.entries(loadsByStatus).map(([k, v]) => [
                // Las etiquetas de estado viven en `nav.status.load` y en
                // camelCase, igual que en la lista de cargas. Traducirlas otra
                // vez aquí haría que una carga se llamara distinto según la
                // pantalla desde la que se mire.
                t(`nav.status.load.${k.replace(/_(.)/g, (_, c: string) => c.toUpperCase())}`),
                String(v),
              ])}
              empty={t('reports.index.empty')}
            />
          </Seccion>
        </div>
      </div>
    </AppLayout>
  )
}

const CAMPO =
  'rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'

function Seccion({
  titulo, nota, onExport, children,
}: { titulo: string; nota?: string; onExport?: () => void; children: React.ReactNode }) {
  const { t } = useI18n()

  return (
    <section className="rounded border border-steel-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="uppercase-heading text-xs text-safety-600">{titulo}</h2>
        {onExport ? (
          <button
            type="button"
            onClick={onExport}
            className="rounded border border-steel-300 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('reports.index.export')}
          </button>
        ) : null}
      </div>
      {nota ? <p className="mt-1 text-xs text-steel-600">{nota}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Tabla({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-steel-600">{empty}</p>
  }

  return (
    // Las tablas anchas se desplazan dentro de su caja; la página no.
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-steel-200 text-left text-xs uppercase tracking-wide text-steel-600">
            {head.map((h, i) => (
              <th key={h} className={`pb-2 ${i === 0 ? '' : 'text-right'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-b border-steel-100 last:border-0">
              {r.map((celda, i) => (
                <td key={i} className={`py-2 ${i === 0 ? 'font-medium text-carbon' : 'text-right tabular-nums'}`}>
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Lista({ items, empty }: { items: string[][]; empty: string }) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-steel-600">{empty}</p>
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map(([label, value]) => (
        <li key={label} className="flex items-baseline justify-between gap-3 border-b border-steel-100 pb-2 text-sm last:border-0">
          <span className="text-steel-700">{label}</span>
          <span className="font-medium tabular-nums text-carbon">{value}</span>
        </li>
      ))}
    </ul>
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
