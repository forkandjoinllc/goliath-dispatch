import { useForm } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'

interface Props {
  reference: string
  tenant: string
  plan: string
  returnUrl: string
  cancelUrl: string
  action: string
}

/**
 * La página de pago del adaptador simulado.
 *
 * Sin el armazón de la aplicación a propósito: quien llega aquí, con un
 * proveedor de verdad, estaría en el dominio de Stripe. Que se vea distinto es
 * parte de lo que enseña.
 *
 * Dos botones, y el de fallar es el importante: el camino del pago rechazado es
 * el que casi nadie prueba y el que más se sufre, porque es el que deja a un
 * cliente sin sistema.
 */
export default function MockCheckoutPage({ reference, tenant, plan, returnUrl, cancelUrl, action }: Props) {
  const { t } = useI18n()

  const form = useForm({
    decision: 'pay',
    reference,
    tenant,
    plan,
    return: btoa(returnUrl),
    cancel: btoa(cancelUrl),
  })

  const decidir = (decision: 'pay' | 'fail') => {
    form.transform((d) => ({ ...d, decision }))
    form.post(action)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
      <div className="rounded border border-warning-300 bg-warning-50 p-4">
        <p className="text-sm font-semibold text-carbon">{t('billing.mock.heading')}</p>
        <p className="mt-1 text-sm text-carbon">{t('billing.mock.body')}</p>
      </div>

      <div className="rounded border border-steel-200 bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-steel-600">{t('billing.mock.plan')}</p>
        <p className="text-lg font-semibold text-carbon">{plan}</p>

        <p className="mt-3 text-xs text-steel-600">{t('billing.mock.noCard')}</p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            disabled={form.processing}
            onClick={() => decidir('pay')}
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {t('billing.mock.pay')}
          </button>

          <button
            type="button"
            disabled={form.processing}
            onClick={() => decidir('fail')}
            className="rounded border border-danger-300 px-4 py-2 text-sm font-semibold text-danger-700 transition hover:bg-danger-50 disabled:opacity-50"
          >
            {t('billing.mock.fail')}
          </button>

          <a href={cancelUrl} className="mt-1 text-center text-sm text-steel-700 hover:underline">
            {t('billing.mock.cancel')}
          </a>
        </div>
      </div>
    </main>
  )
}
