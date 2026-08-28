import { Link, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

interface Line {
  id: string
  sequence: number
  descriptionEn: string
  descriptionEs: string | null
  amountCents: number
  kind: string
  loadId: string | null
  loadNumber: string | null
}

interface Props {
  invoice: {
    id: string
    number: string
    carrierId: string
    carrierName: string | null
    status: string
    subtotalCents: number
    totalCents: number
    amountPaidCents: number
    balanceCents: number
    paymentTermsDays: number
    issueDate: string | null
    dueDate: string | null
    paidAt: string | null
    voidedAt: string | null
    notes: string | null
    voidReason: string | null
    lines: Line[]
  }
  can: { send: boolean; pay: boolean; changeStatus: boolean }
}

export default function InvoiceShow({ invoice, can }: Props) {
  const { t, locale } = useI18n()
  const anulada = invoice.status === 'voided'

  return (
    <AppLayout
      title={invoice.number}
      description={invoice.carrierName ?? ''}
      crumbs={[{ label: t('invoices.index.title'), href: '/invoices' }, { label: invoice.number }]}
    >
      <div className="flex max-w-4xl flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <Tile label={t('invoices.show.status')} value={t(`invoices.status.${invoice.status}`)} />
          <Tile label={t('invoices.show.total')} value={formatCents(invoice.totalCents, locale)} />
          <Tile label={t('invoices.show.paid')} value={formatCents(invoice.amountPaidCents, locale)} />
          <Tile label={t('invoices.show.balance')} value={formatCents(invoice.balanceCents, locale)} />
        </div>

        {anulada ? (
          <div className="rounded border-l-4 border-danger-500 bg-danger-50 p-3 text-sm">
            <p className="font-semibold">{t('invoices.show.voided')}</p>
            {invoice.voidReason ? <p className="mt-1">{invoice.voidReason}</p> : null}
          </div>
        ) : null}

        <div className="overflow-x-auto rounded border border-steel-200 bg-white">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-steel-50 text-left text-xs uppercase tracking-wide text-steel-600">
              <tr>
                <th className="px-4 py-2.5">{t('invoices.show.concept')}</th>
                <th className="px-4 py-2.5">{t('invoices.show.load')}</th>
                <th className="px-4 py-2.5 text-right">{t('invoices.show.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id} className="border-t border-steel-100">
                  {/* El texto se guardó al emitir. No se traduce ahora: la
                      factura dice lo que decía. */}
                  <td className="px-4 py-2.5">
                    {locale === 'es' && l.descriptionEs ? l.descriptionEs : l.descriptionEn}
                  </td>
                  <td className="px-4 py-2.5">
                    {l.loadId ? (
                      <Link href={`/loads/${l.loadId}`} className="text-navy-700 underline">
                        {l.loadNumber}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(l.amountCents, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="grid gap-x-6 gap-y-2 rounded border border-steel-200 bg-white p-4 sm:grid-cols-2">
          <Item label={t('invoices.show.issued')}>{invoice.issueDate ?? '—'}</Item>
          <Item label={t('invoices.show.due')}>{invoice.dueDate ?? '—'}</Item>
          <Item label={t('invoices.show.terms')}>
            {t('invoices.show.nDays', { n: String(invoice.paymentTermsDays) })}
          </Item>
          <Item label={t('invoices.show.carrier')}>{invoice.carrierName ?? '—'}</Item>
        </dl>

        <Actions invoice={invoice} can={can} />
      </div>
    </AppLayout>
  )
}

function Actions({ invoice, can }: Props) {
  const { t } = useI18n()
  const [abierto, setAbierto] = useState<'pay' | 'void' | null>(null)

  const enviar = useForm({})
  const cobro = useForm({ amount_cents: '' })
  const anular = useForm({ reason: '' })

  if (invoice.status === 'voided') return null

  return (
    <div className="flex flex-col gap-3 rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        {can.send && invoice.status === 'draft' ? (
          <button
            type="button"
            disabled={enviar.processing}
            onClick={() => enviar.post(`/invoices/${invoice.id}/send`, { preserveScroll: true })}
            className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:opacity-50"
          >
            {t('invoices.show.send')}
          </button>
        ) : null}

        {can.pay && invoice.status !== 'draft' && invoice.balanceCents > 0 ? (
          <button
            type="button"
            onClick={() => setAbierto(abierto === 'pay' ? null : 'pay')}
            className="rounded border border-steel-300 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('invoices.show.recordPayment')}
          </button>
        ) : null}

        {can.changeStatus && invoice.amountPaidCents === 0 ? (
          <button
            type="button"
            onClick={() => setAbierto(abierto === 'void' ? null : 'void')}
            className="rounded border border-danger-300 px-4 py-2 text-sm font-medium text-danger-700 transition hover:bg-danger-50"
          >
            {t('invoices.show.void')}
          </button>
        ) : null}
      </div>

      {abierto === 'pay' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            cobro.transform((d) => ({ amount_cents: Math.round(Number(d.amount_cents || 0) * 100) }))
            cobro.post(`/invoices/${invoice.id}/payments`, {
              preserveScroll: true,
              onSuccess: () => { cobro.reset(); setAbierto(null) },
            })
          }}
          className="flex flex-wrap items-end gap-3 border-t border-steel-100 pt-3"
        >
          <label className="flex flex-col gap-1">
            {/* Se anota lo COBRADO, no se marca «pagada». Un botón sin importe
                deja facturas cuadradas en pantalla y descuadradas en el banco. */}
            <span className="text-xs font-medium text-steel-700">{t('invoices.show.amountReceived')}</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={cobro.data.amount_cents}
              onChange={(e) => cobro.setData('amount_cents', e.target.value)}
              className="rounded border border-steel-300 px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
            />
          </label>
          <button
            type="submit"
            disabled={cobro.processing}
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {t('invoices.show.savePayment')}
          </button>
          {cobro.errors.amount_cents ? (
            <p role="alert" className="w-full text-sm text-danger-700">{cobro.errors.amount_cents}</p>
          ) : null}
        </form>
      ) : null}

      {abierto === 'void' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            anular.post(`/invoices/${invoice.id}/void`, { preserveScroll: true })
          }}
          className="flex flex-col gap-2 border-t border-steel-100 pt-3"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('invoices.show.voidReason')}</span>
            <textarea
              rows={3}
              value={anular.data.reason}
              onChange={(e) => anular.setData('reason', e.target.value)}
              className="rounded border border-steel-300 px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
            />
            <span className="text-xs text-steel-600">{t('invoices.show.voidHint')}</span>
          </label>
          <div>
            <button
              type="submit"
              disabled={anular.processing}
              className="rounded bg-danger-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-danger-700 disabled:opacity-50"
            >
              {t('invoices.show.confirmVoid')}
            </button>
          </div>
          {anular.errors.reason ? (
            <p role="alert" className="text-sm text-danger-700">{anular.errors.reason}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-steel-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-steel-600">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-carbon">{value}</p>
    </div>
  )
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-steel-600">{label}</dt>
      <dd className="font-medium text-carbon">{children}</dd>
    </div>
  )
}
