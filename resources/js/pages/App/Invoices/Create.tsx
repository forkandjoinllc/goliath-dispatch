import { Link, router, useForm } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

interface BillableLoad {
  id: string
  number: string
  commodity: string | null
  deliveredAt: string | null
  estimatedFeeCents: number
}

interface Props {
  carriers: { id: string; name: string }[]
  carrierId: string | null
  loads: BillableLoad[]
}

/**
 * Facturar es elegir transportista y marcar cargas.
 *
 * Primero el transportista, y solo entonces sus cargas: una factura es de UNO,
 * y una lista mezclada invita a marcar dos de sitios distintos y descubrirlo al
 * guardar.
 */
export default function InvoiceCreate({ carriers, carrierId, loads }: Props) {
  const { t, locale } = useI18n()

  const form = useForm({
    carrier_id: carrierId ?? '',
    load_ids: [] as string[],
    payment_terms_days: 30,
  })

  const alternar = (id: string) => {
    form.setData(
      'load_ids',
      form.data.load_ids.includes(id)
        ? form.data.load_ids.filter((x) => x !== id)
        : [...form.data.load_ids, id],
    )
  }

  const estimado = loads
    .filter((l) => form.data.load_ids.includes(l.id))
    .reduce((sum, l) => sum + l.estimatedFeeCents, 0)

  return (
    <AppLayout
      title={t('invoices.create.title')}
      description={t('invoices.create.subtitle')}
      crumbs={[{ label: t('invoices.index.title'), href: '/invoices' }, { label: t('invoices.create.title') }]}
    >
      <div className="flex max-w-3xl flex-col gap-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-steel-700">{t('invoices.create.carrier')}</span>
          <select
            value={carrierId ?? ''}
            onChange={(e) => router.get('/invoices/create', e.target.value === '' ? {} : { carrier: e.target.value })}
            className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          >
            <option value="">{t('invoices.create.chooseCarrier')}</option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-steel-600">{t('invoices.create.carrierHint')}</span>
        </label>

        {carrierId !== null ? (
          loads.length === 0 ? (
            <p className="rounded border border-steel-200 bg-white p-4 text-sm text-steel-700">
              {t('invoices.create.nothingToBill')}
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                form.post('/invoices')
              }}
              className="flex flex-col gap-4"
            >
              <div className="overflow-x-auto rounded border border-steel-200 bg-white">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="bg-steel-50 text-left text-xs uppercase tracking-wide text-steel-600">
                    <tr>
                      <th className="px-4 py-2.5" />
                      <th className="px-4 py-2.5">{t('invoices.create.load')}</th>
                      <th className="px-4 py-2.5">{t('invoices.create.delivered')}</th>
                      <th className="px-4 py-2.5 text-right">{t('invoices.create.estimatedFee')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loads.map((l) => (
                      <tr key={l.id} className="border-t border-steel-100">
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={form.data.load_ids.includes(l.id)}
                            onChange={() => alternar(l.id)}
                            aria-label={l.number}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="font-medium">{l.number}</span>
                          {l.commodity ? <span className="text-steel-600"> · {l.commodity}</span> : null}
                        </td>
                        <td className="px-4 py-2.5">{(l.deliveredAt ?? '').slice(0, 10) || '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatCents(l.estimatedFeeCents, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Estimación, no factura. El importe definitivo lo calcula el
                  servidor con los gastos aprobados incluidos, y lo congela. */}
              <p className="text-sm text-steel-700">
                {t('invoices.create.estimateNote', { amount: formatCents(estimado, locale) })}
              </p>

              <label className="flex max-w-xs flex-col gap-1">
                <span className="text-xs font-medium text-steel-700">{t('invoices.create.terms')}</span>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={form.data.payment_terms_days}
                  onChange={(e) => form.setData('payment_terms_days', Number(e.target.value))}
                  className="rounded border border-steel-300 px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
                />
                <span className="text-xs text-steel-600">{t('invoices.create.termsHint')}</span>
              </label>

              {form.errors.load_ids ? (
                <p role="alert" className="rounded border-l-4 border-danger-500 bg-danger-50 p-2 text-sm">
                  {form.errors.load_ids}
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={form.processing || form.data.load_ids.length === 0}
                  className="rounded bg-safety-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {form.processing ? t('common.states.saving') : t('invoices.create.submit')}
                </button>
                <Link href="/invoices" className="text-sm font-medium text-navy-700 underline">
                  {t('invoices.create.cancel')}
                </Link>
              </div>
            </form>
          )
        ) : null}
      </div>
    </AppLayout>
  )
}
