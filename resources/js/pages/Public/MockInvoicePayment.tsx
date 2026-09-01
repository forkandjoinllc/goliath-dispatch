import { Head, useForm } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'

interface Props {
  reference: string
  key: string
  amountCents: number
  returnUrl: string
  action: string
}

/**
 * La página de pago cuando no hay pasarela.
 *
 * Deja recorrer el camino del FALLO, que es el que casi nadie prueba y el que
 * más se sufre. No pide ningún dato de tarjeta — ni aquí ni con pasarela de
 * verdad: esos datos se introducen siempre en la página del proveedor.
 */
export default function MockInvoicePayment({ reference, key: clave, amountCents, returnUrl, action }: Props) {
  const { t } = useI18n()
  const form = useForm({ decision: 'pay', key: clave, reference, return: btoa(returnUrl) })

  const decidir = (decision: 'pay' | 'fail') => {
    form.transform((d) => ({ ...d, decision }))
    form.post(action)
  }

  return (
    <>
      <Head title={t('invoices.mockPay.title')} />
      <main className="min-h-screen bg-steel-50 px-4 py-10">
        <div className="mx-auto max-w-lg rounded border border-warning-300 bg-white p-6">
          <p className="text-sm font-semibold text-carbon">{t('invoices.mockPay.title')}</p>
          <p className="mt-2 text-sm text-steel-700">{t('invoices.mockPay.body')}</p>

          <p className="mt-4 text-sm text-steel-700">
            {t('invoices.mockPay.amount')}:{' '}
            <span className="font-semibold text-carbon">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountCents / 100)}
            </span>
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={form.processing}
              onClick={() => decidir('pay')}
              className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
            >
              {t('invoices.mockPay.pay')}
            </button>
            <button
              type="button"
              disabled={form.processing}
              onClick={() => decidir('fail')}
              className="rounded border border-danger-300 bg-white px-4 py-2 text-sm font-medium text-danger-700 transition hover:bg-danger-50 disabled:opacity-50"
            >
              {t('invoices.mockPay.fail')}
            </button>
          </div>
        </div>
      </main>
    </>
  )
}
