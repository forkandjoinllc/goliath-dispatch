import { useForm } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Plan {
  code: string
  nameEn: string
  nameEs: string
  priceCents: number
  trialDays: number
  maxUsers: number | null
  maxCarriers: number | null
  maxLoadsPerMonth: number | null
}

interface Subscription {
  status: string
  planCode: string | null
  planNameEn: string | null
  planNameEs: string | null
  priceCents: number | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  pastDueSince: string | null
  cancelAtPeriodEnd: boolean
  customerId: string | null
}

interface Props {
  subscription: Subscription | null
  plans: Plan[]
  events: { id: string; type: string; status: string; error: string | null; at: string }[]
  provider: { name: string; live: boolean }
  portalUrl: string | null
  can: { pay: boolean }
}

/**
 * La facturación de la empresa.
 *
 * Lo primero que se dice, arriba del todo, es SI EL COBRO ES DE VERDAD. Quien
 * abre esta pantalla quiere saber si al pulsar «Pagar» se le va a cobrar, y esa
 * pregunta no se contesta en la salud de la plataforma ni en un `.env`: se
 * contesta aquí, antes que nada.
 *
 * No hay formulario de tarjeta y no lo habrá. El botón lleva a una página
 * alojada por el proveedor. Este servidor no ve el número, no lo registra y no
 * lo guarda.
 */
export default function BillingPage({ subscription, plans, events, provider, portalUrl, can }: Props) {
  const { t, locale } = useI18n()

  const nombrePlan = (p: { nameEs: string; nameEn: string }) => (locale === 'es' ? p.nameEs : p.nameEn)

  return (
    <AppLayout
      title={t('billing.index.title')}
      heading={t('billing.index.title')}
      description={t('billing.index.description')}
      crumbs={[{ label: t('billing.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        <section
          className={`rounded border p-3 ${
            provider.live ? 'border-success-500 bg-success-50' : 'border-warning-300 bg-warning-50'
          }`}
        >
          <p className="text-sm font-semibold text-carbon">
            {provider.live ? t('billing.provider.liveTitle') : t('billing.provider.mockTitle')}
          </p>
          <p className="mt-0.5 text-sm text-carbon">
            {provider.live ? t('billing.provider.liveHint') : t('billing.provider.mockHint')}
          </p>
        </section>

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('billing.index.currentPlan')}</p>

          {subscription === null ? (
            <p className="mt-2 text-sm text-steel-600">{t('billing.index.noSubscription')}</p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-baseline gap-3">
                <span className="text-xl font-semibold text-carbon">
                  {subscription.planCode === null
                    ? '—'
                    : locale === 'es'
                      ? (subscription.planNameEs ?? subscription.planCode)
                      : (subscription.planNameEn ?? subscription.planCode)}
                </span>
                <Marca estado={subscription.status} />
                {subscription.priceCents !== null ? (
                  <span className="text-sm text-steel-700">
                    {t('billing.index.perMonth', { amount: dinero(subscription.priceCents) })}
                  </span>
                ) : null}
              </div>

              <ul className="mt-2 flex flex-col gap-0.5 text-sm text-steel-700">
                {subscription.status === 'trialing' && subscription.trialEndsAt !== null ? (
                  <li>{t('billing.index.trialEnds', { date: subscription.trialEndsAt })}</li>
                ) : null}
                {subscription.currentPeriodEnd !== null ? (
                  <li>{t('billing.index.periodEnds', { date: subscription.currentPeriodEnd })}</li>
                ) : null}
                {subscription.pastDueSince !== null ? (
                  <li className="text-danger-700">
                    {t('billing.index.pastDueSince', { date: subscription.pastDueSince })}
                  </li>
                ) : null}
                {subscription.cancelAtPeriodEnd ? <li>{t('billing.index.cancelAtPeriodEnd')}</li> : null}
              </ul>

              {/*
                Lo que un estado SIGNIFICA, no solo cómo se llama. «Pago
                pendiente» sin más deja a quien lo lee pensando que le van a
                cortar el acceso mañana, y no es verdad.
              */}
              <Explicacion estado={subscription.status} />

              {portalUrl !== null ? (
                <div className="mt-3">
                  <a
                    href={portalUrl}
                    className="text-sm font-medium text-navy-700 hover:underline"
                  >
                    {t('billing.index.portal')}
                  </a>
                  <p className="mt-0.5 text-xs text-steel-600">{t('billing.index.portalHint')}</p>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('billing.plans.title')}</p>

          <div className="mt-3 grid gap-4 md:grid-cols-3">
            {plans.map((p) => (
              <div
                key={p.code}
                className={`rounded border p-4 ${
                  p.code === subscription?.planCode ? 'border-navy-600 bg-navy-50' : 'border-steel-200'
                }`}
              >
                <p className="text-sm font-semibold text-carbon">{nombrePlan(p)}</p>
                <p className="mt-1 text-2xl font-semibold text-carbon">{dinero(p.priceCents)}</p>
                <p className="text-xs text-steel-600">{t('billing.index.perMonth', { amount: '' }).trim()}</p>

                <ul className="mt-3 flex flex-col gap-0.5 text-xs text-steel-700">
                  <li>{limite(t, 'users', p.maxUsers)}</li>
                  <li>{limite(t, 'carriers', p.maxCarriers)}</li>
                  <li>{limite(t, 'loads', p.maxLoadsPerMonth)}</li>
                  <li>{t('billing.plans.trialDays', { n: p.trialDays })}</li>
                </ul>

                {p.code === subscription?.planCode ? (
                  <p className="mt-3 text-xs font-medium text-navy-800">{t('billing.plans.current')}</p>
                ) : can.pay ? (
                  <Pagar planCode={p.code} />
                ) : null}
              </div>
            ))}
          </div>

          {can.pay ? <p className="mt-3 text-xs text-steel-600">{t('billing.index.payHint')}</p> : null}
        </section>

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('billing.events.title')}</p>

          {events.length === 0 ? (
            <>
              <p className="mt-2 text-sm text-steel-600">{t('billing.events.empty')}</p>
              <p className="mt-0.5 text-xs text-steel-600">{t('billing.events.emptyHint')}</p>
            </>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-steel-200 text-left text-xs uppercase tracking-wide text-steel-600">
                    <th className="py-2 pr-4">{t('billing.events.at')}</th>
                    <th className="py-2 pr-4">{t('billing.events.type')}</th>
                    <th className="py-2">{t('billing.events.state')}</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-b border-steel-100">
                      <td className="py-2 pr-4 text-steel-700">{e.at}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-carbon">{e.type}</td>
                      <td className="py-2 text-carbon">
                        {t(`billing.eventStatus.${e.status}`)}
                        {e.error !== null ? (
                          <span className="ml-2 text-xs text-danger-700">{e.error}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  )
}

function Marca({ estado }: { estado: string }) {
  const { t } = useI18n()

  const tono: Record<string, string> = {
    active: 'bg-success-50 text-success-700',
    trialing: 'bg-navy-50 text-navy-800',
    past_due: 'bg-warning-50 text-warning-700',
    suspended: 'bg-danger-50 text-danger-700',
    cancelled: 'bg-steel-100 text-steel-700',
  }

  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tono[estado] ?? 'bg-steel-100 text-steel-700'}`}>
      {t(`billing.status.${estado}`)}
    </span>
  )
}

function Explicacion({ estado }: { estado: string }) {
  const { t } = useI18n()

  if (estado !== 'past_due' && estado !== 'cancelled') {
    return null
  }

  return (
    <p className="mt-2 rounded border border-steel-200 bg-steel-50 p-2 text-xs text-carbon">
      {t(`billing.statusHint.${estado}`)}
    </p>
  )
}

function Pagar({ planCode }: { planCode: string }) {
  const { t } = useI18n()
  const form = useForm({ plan_code: planCode })

  return (
    <button
      type="button"
      disabled={form.processing}
      onClick={() => form.post('/billing/checkout')}
      className="mt-3 w-full rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
    >
      {t('billing.plans.choose')}
    </button>
  )
}

function limite(
  t: (k: string, p?: Record<string, string | number>) => string,
  clave: string,
  valor: number | null,
): string {
  return valor === null ? t('billing.plans.unlimited') : t(`billing.plans.${clave}`, { n: valor })
}

function dinero(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}
