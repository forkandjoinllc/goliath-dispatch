import { Link, router, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { Pager, type PageMeta } from '@/components/App/Pager'
import { useI18n } from '@/lib/i18n'

interface Row {
  id: string
  invoiceId: string
  invoiceNumber?: string | null
  amountCents: number
  refundedCents: number
  method: string
  status: string
  reference: string | null
  receivedOn: string | null
  notes: string | null
  disputeReason: string | null
  recordedBy?: string | null
}

interface Props {
  payments: { data: Row[]; meta: PageMeta }
  filters: { status: string; method: string; invoice: string }
  statuses: string[]
  methods: string[]
  totals: { settledCents: number; pendingCents: number; disputedCents: number }
  can: { refund: boolean }
}

export default function PaymentsIndex({ payments, filters, statuses, methods, totals, can }: Props) {
  const { t, locale } = useI18n()

  const filtrar = (patch: Partial<Props['filters']>) =>
    router.get('/payments', { ...filters, ...patch }, { preserveState: true, replace: true })

  return (
    <AppLayout
      title={t('payments.index.title')}
      description={t('payments.index.subtitle')}
      crumbs={[{ label: t('payments.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label={t('payments.index.settled')} value={formatCents(totals.settledCents, locale)} />
          {/* Anotado y sin compensar: está en la lista y NO cuenta como cobrado. */}
          <Tile label={t('payments.index.pending')} value={formatCents(totals.pendingCents, locale)} />
          {/* En disputa: el banco puede retirarlo. */}
          <Tile label={t('payments.index.disputed')} value={formatCents(totals.disputedCents, locale)} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Filtro label={t('payments.index.status')}>
            <select
              value={filters.status}
              onChange={(e) => filtrar({ status: e.target.value })}
              className={CAMPO}
            >
              <option value="">{t('payments.index.anyStatus')}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{t(`payments.status.${s}`)}</option>
              ))}
            </select>
          </Filtro>

          <Filtro label={t('payments.fields.method')}>
            <select
              value={filters.method}
              onChange={(e) => filtrar({ method: e.target.value })}
              className={CAMPO}
            >
              <option value="">{t('payments.index.anyMethod')}</option>
              {methods.map((m) => (
                <option key={m} value={m}>{t(`payments.methods.${m}`)}</option>
              ))}
            </select>
          </Filtro>

          <Filtro label={t('payments.index.invoice')}>
            <input
              type="search"
              defaultValue={filters.invoice}
              onBlur={(e) => filtrar({ invoice: e.target.value })}
              placeholder={t('payments.index.invoicePlaceholder')}
              className={CAMPO}
            />
          </Filtro>
        </div>

        <div className="flex flex-col gap-3">
          {payments.data.length === 0 ? (
            <p className="rounded border border-steel-200 bg-white p-8 text-center text-sm text-steel-600">
              {t('payments.index.empty')}
            </p>
          ) : null}

          {payments.data.map((p) => (
            <PaymentCard key={p.id} payment={p} canRefund={can.refund} />
          ))}
        </div>

        <Pager meta={payments.meta} path="/payments" params={{ ...filters }} />
      </div>
    </AppLayout>
  )
}

function PaymentCard({ payment: p, canRefund }: { payment: Row; canRefund: boolean }) {
  const { t, locale } = useI18n()
  const [abierto, setAbierto] = useState<'refund' | 'dispute' | null>(null)

  const devolucion = useForm({ amount_cents: '', reason: '' })
  const disputa = useForm({ reason: '' })

  const disponible = p.amountCents - p.refundedCents
  const cerrado = p.status === 'refunded' || p.status === 'disputed' || p.status === 'cancelled'

  return (
    <div className="rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-carbon">
            {p.invoiceNumber ? (
              <Link href={`/invoices/${p.invoiceId}`} className="underline">{p.invoiceNumber}</Link>
            ) : (
              t('payments.index.noInvoice')
            )}
            <span className="ml-2 font-normal text-steel-600">{t(`payments.methods.${p.method}`)}</span>
          </p>
          <p className="mt-0.5 text-xs text-steel-600">
            {p.receivedOn ?? ''}
            {p.reference ? ` · ${p.reference}` : ''}
            {p.recordedBy ? ` · ${t('payments.index.recordedBy', { name: p.recordedBy })}` : ''}
          </p>
          {p.notes ? <p className="mt-1 text-sm text-steel-700">{p.notes}</p> : null}
          {p.disputeReason ? (
            <p className="mt-1 text-sm text-danger-700">{p.disputeReason}</p>
          ) : null}
        </div>

        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums text-carbon">
            {formatCents(p.amountCents, locale)}
          </p>
          <p className="text-xs text-steel-600">{t(`payments.status.${p.status}`)}</p>
          {p.refundedCents > 0 ? (
            <p className="text-xs text-danger-700">
              {t('payments.show.refunded', { amount: formatCents(p.refundedCents, locale) })}
            </p>
          ) : null}
        </div>
      </div>

      {canRefund && ! cerrado ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-steel-100 pt-3">
          <button
            type="button"
            onClick={() => setAbierto(abierto === 'refund' ? null : 'refund')}
            className="rounded border border-steel-300 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('payments.index.refund')}
          </button>
          <button
            type="button"
            onClick={() => setAbierto(abierto === 'dispute' ? null : 'dispute')}
            className="rounded border border-danger-300 px-3 py-1.5 text-xs font-medium text-danger-700 transition hover:bg-danger-50"
          >
            {t('payments.index.dispute')}
          </button>
        </div>
      ) : null}

      {abierto === 'refund' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            devolucion.transform((d) => ({
              ...d,
              amount_cents: Math.round(Number(d.amount_cents || 0) * 100),
            }))
            devolucion.post(`/payments/${p.id}/refund`, {
              preserveScroll: true,
              onSuccess: () => { devolucion.reset(); setAbierto(null) },
            })
          }}
          className="mt-3 flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">
              {t('payments.index.refundAmount', { max: formatCents(disponible, locale) })}
            </span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={disponible / 100}
              value={devolucion.data.amount_cents}
              onChange={(e) => devolucion.setData('amount_cents', e.target.value)}
              className={CAMPO}
            />
          </label>
          <label className="flex min-w-56 flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('payments.index.reason')}</span>
            <input
              type="text"
              value={devolucion.data.reason}
              onChange={(e) => devolucion.setData('reason', e.target.value)}
              className={CAMPO}
            />
          </label>
          <button
            type="submit"
            disabled={devolucion.processing}
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {t('payments.index.confirmRefund')}
          </button>
          {devolucion.errors.amount_cents ? (
            <p role="alert" className="w-full text-sm text-danger-700">{devolucion.errors.amount_cents}</p>
          ) : null}
          {devolucion.errors.reason ? (
            <p role="alert" className="w-full text-sm text-danger-700">{devolucion.errors.reason}</p>
          ) : null}
        </form>
      ) : null}

      {abierto === 'dispute' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            disputa.post(`/payments/${p.id}/dispute`, {
              preserveScroll: true,
              onSuccess: () => { disputa.reset(); setAbierto(null) },
            })
          }}
          className="mt-3 flex flex-col gap-2"
        >
          {/* Marcar en disputa QUITA ese dinero del cobrado: la factura vuelve a
              deber lo que este cobro cubría. Se dice antes de pulsar. */}
          <p className="text-xs text-steel-600">{t('payments.index.disputeWarning')}</p>
          <textarea
            rows={2}
            value={disputa.data.reason}
            onChange={(e) => disputa.setData('reason', e.target.value)}
            placeholder={t('payments.index.reason')}
            className="rounded border border-steel-300 px-3 py-2 text-sm outline-none focus:border-navy-500"
          />
          <div>
            <button
              type="submit"
              disabled={disputa.processing}
              className="rounded bg-danger-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-danger-700 disabled:opacity-50"
            >
              {t('payments.index.confirmDispute')}
            </button>
          </div>
          {disputa.errors.reason ? (
            <p role="alert" className="text-sm text-danger-700">{disputa.errors.reason}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}

const CAMPO =
  'rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'

function Filtro({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-steel-700">{label}</span>
      {children}
    </label>
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
