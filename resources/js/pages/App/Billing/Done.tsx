import { Link } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Props {
  subscription: { status: string } | null
}

/**
 * La vuelta de la página de pago.
 *
 * Esta pantalla NO activa nada, y su texto lo dice: «no hace falta que esperes
 * aquí; si cierras la ventana, se aplica igual». Es literalmente verdad, y
 * decirlo evita la llamada de quien pagó, vio esto, y no sabe si su dinero se
 * perdió.
 *
 * Quien mueve la suscripción es el suceso del proveedor. Ver
 * App\Support\Billing\Subscriptions.
 */
export default function BillingDonePage({ subscription }: Props) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t('billing.done.title')}
      heading={t('billing.done.heading')}
      crumbs={[{ label: t('billing.index.title'), href: '/billing' }, { label: t('billing.done.title') }]}
    >
      <div className="flex flex-col gap-4">
        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm text-carbon">{t('billing.done.body')}</p>

          {subscription !== null ? (
            <p className="mt-3 text-sm text-steel-700">
              {t(`billing.status.${subscription.status}`)}
            </p>
          ) : null}

          <Link href="/billing" className="mt-3 inline-block text-sm font-medium text-navy-700 hover:underline">
            {t('billing.done.back')}
          </Link>
        </section>
      </div>
    </AppLayout>
  )
}
