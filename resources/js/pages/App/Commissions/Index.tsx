import { Link, router, useForm } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

interface Line {
  id: string
  loadId: string | null
  loadNumber: string | null
  amountCents: number
  basis: string
  basisAmountCents: number
  percentageBps: number
  status: string
  accruedOn: string
  paidOn: string | null
}

interface Dispatcher {
  userId: string
  name: string
  totalCents: number
  lines: Line[]
}

interface Props {
  dispatchers: Dispatcher[]
  filters: { status: string; from: string | null; to: string | null }
  statuses: string[]
  totals: { shownCents: number; rows: number }
  onlyMine: boolean
  can: { pay: boolean }
}

export default function CommissionsIndex({ dispatchers, filters, statuses, totals, onlyMine, can }: Props) {
  const { t, locale } = useI18n()

  const filtrar = (patch: Partial<Props['filters']>) =>
    router.get('/commissions', { ...filters, ...patch }, { preserveState: true, replace: true })

  return (
    <AppLayout
      title={t('commissions.index.title')}
      description={onlyMine ? t('commissions.index.subtitleOwn') : t('commissions.index.subtitle')}
      crumbs={[{ label: t('commissions.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        <div className="rounded border border-steel-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-steel-600">
            {t(`commissions.status.${filters.status}`)}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-carbon">
            {formatCents(totals.shownCents, locale)}
          </p>
          <p className="mt-1 text-xs text-steel-600">
            {t('commissions.index.rows', { n: String(totals.rows) })}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('commissions.index.status')}</span>
            <select
              value={filters.status}
              onChange={(e) => filtrar({ status: e.target.value })}
              className={CAMPO}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>{t(`commissions.status.${s}`)}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('commissions.index.from')}</span>
            <input
              type="date"
              defaultValue={filters.from ?? ''}
              onChange={(e) => filtrar({ from: e.target.value })}
              className={CAMPO}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('commissions.index.to')}</span>
            <input
              type="date"
              defaultValue={filters.to ?? ''}
              onChange={(e) => filtrar({ to: e.target.value })}
              className={CAMPO}
            />
          </label>
        </div>

        {dispatchers.length === 0 ? (
          <p className="rounded border border-steel-200 bg-white p-8 text-center text-sm text-steel-600">
            {t('commissions.index.empty')}
          </p>
        ) : null}

        {dispatchers.map((d) => (
          <DispatcherBlock key={d.userId} dispatcher={d} filters={filters} canPay={can.pay} />
        ))}
      </div>
    </AppLayout>
  )
}

function DispatcherBlock({
  dispatcher: d,
  filters,
  canPay,
}: {
  dispatcher: Dispatcher
  filters: Props['filters']
  canPay: boolean
}) {
  const { t, locale } = useI18n()
  const pago = useForm({
    dispatcher_user_id: d.userId,
    status: filters.status,
    from: filters.from ?? '',
    to: filters.to ?? '',
  })

  const pagable = filters.status === 'accrued' || filters.status === 'approved'

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-carbon">{d.name}</h2>
        <p className="text-lg font-semibold tabular-nums text-carbon">
          {formatCents(d.totalCents, locale)}
        </p>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {d.lines.map((l) => (
          <li
            key={l.id}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-steel-100 pb-2 text-sm last:border-0"
          >
            <span>
              {l.loadId ? (
                <Link href={`/loads/${l.loadId}`} className="font-medium text-navy-700 underline">
                  {l.loadNumber}
                </Link>
              ) : (
                <span className="text-steel-600">{t('commissions.index.noLoad')}</span>
              )}
              {/* Por qué sale ese importe, sin ir a buscarlo: base, sobre qué, y
                  a qué porcentaje. Los tres van copiados en la propia fila. */}
              <span className="ml-2 text-xs text-steel-600">
                {t('commissions.index.formula', {
                  pct: (l.percentageBps / 100).toFixed(2),
                  basis: t(`commissions.basis.${l.basis}`),
                  amount: formatCents(l.basisAmountCents, locale),
                })}
              </span>
            </span>
            <span className="flex items-baseline gap-3">
              <span className="text-xs text-steel-600">{l.paidOn ?? l.accruedOn}</span>
              <span className="font-medium tabular-nums text-carbon">
                {formatCents(l.amountCents, locale)}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {canPay && pagable ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            pago.post('/commissions/pay', { preserveScroll: true })
          }}
          className="mt-3 border-t border-steel-100 pt-3"
        >
          {/* Se paga el bloque entero del periodo mostrado, que es como se paga
              de verdad: una transferencia cubre un mes. */}
          <button
            type="submit"
            disabled={pago.processing}
            className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:opacity-50"
          >
            {t('commissions.index.pay', { amount: formatCents(d.totalCents, locale) })}
          </button>
        </form>
      ) : null}
    </section>
  )
}

const CAMPO =
  'rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'
