import { Link, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { Estado } from './Index'

interface Uso {
  used: number
  limit: number | null
  /** Si este tope BLOQUEA en esta empresa, o solo se cuenta. */
  enforced: boolean
}

interface Props {
  tenant: {
    id: string
    slug: string
    name: string
    legalName: string
    status: string
    subscriptionStatus: string | null
    planCode: string | null
    monthlyPriceCents: number | null
    trialEndsOn: string | null
    periodEnd: string | null
    pastDueSince: string | null
    createdOn: string
    customDomain: string | null
    customDomainVerified: boolean
    stripeCustomerId: string | null
    limitsEnforcedAt: string | null
  }
  usage: { users: Uso; carriers: Uso; loadsThisMonth: Uso }
  can: { suspend: boolean }
}

export default function PlatformTenantShow({ tenant, usage, can }: Props) {
  const { t, locale } = useI18n()
  const [abierto, setAbierto] = useState(false)

  const suspendida = tenant.status === 'suspended'
  const form = useForm({ action: suspendida ? 'reactivate' : 'suspend', reason: '' })

  return (
    <AppLayout
      title={tenant.name}
      description={t('platform.show.title')}
      crumbs={[
        { label: t('platform.tenants.title'), href: '/platform/tenants' },
        { label: tenant.name },
      ]}
    >
      <div className="flex flex-col gap-4">
        <div className="rounded border border-steel-200 bg-white p-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Dato label={t('platform.show.legalName')} value={tenant.legalName} />
            <Dato label={t('platform.show.slug')} value={tenant.slug} mono />
            <div>
              <dt className="text-xs uppercase tracking-wide text-steel-600">
                {t('platform.show.status')}
              </dt>
              <dd className="mt-0.5">
                <Estado value={tenant.status} />
              </dd>
            </div>
            <Dato
              label={t('platform.show.subscription')}
              value={tenant.subscriptionStatus ? t(`platform.status.${tenant.subscriptionStatus}`) : '—'}
            />
            <Dato label={t('platform.show.plan')} value={tenant.planCode ?? '—'} />
            <Dato
              label={t('platform.show.monthly')}
              value={
                tenant.monthlyPriceCents === null ? '—' : formatCents(tenant.monthlyPriceCents, locale)
              }
            />
            <Dato label={t('platform.show.trialEnds')} value={tenant.trialEndsOn ?? '—'} />
            <Dato label={t('platform.show.periodEnds')} value={tenant.periodEnd ?? '—'} />
            {tenant.pastDueSince ? (
              <Dato label={t('platform.show.pastDueSince')} value={tenant.pastDueSince} />
            ) : null}
            <Dato
              label={t('platform.show.customDomain')}
              value={
                tenant.customDomain
                  ? `${tenant.customDomain} (${
                      tenant.customDomainVerified
                        ? t('platform.show.verified')
                        : t('platform.show.unverified')
                    })`
                  : '—'
              }
            />
            <Dato label={t('platform.show.stripeCustomer')} value={tenant.stripeCustomerId ?? '—'} mono />
          </dl>

          <p className="mt-4 border-t border-steel-100 pt-3 text-xs text-steel-600">
            {t('platform.show.billingNote')}
          </p>
        </div>

        <div className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('platform.show.usage')}</p>
          <p className="mt-0.5 text-xs text-steel-600">{t('platform.show.usageHint')}</p>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Consumo label={t('platform.show.users')} uso={usage.users} />
            <Consumo label={t('platform.show.carriers')} uso={usage.carriers} />
            <Consumo label={t('platform.show.loadsThisMonth')} uso={usage.loadsThisMonth} />
          </div>

          <Bloqueo tenant={tenant} usage={usage} />
        </div>

        {can.suspend ? (
          <div className={`rounded border p-4 ${suspendida ? 'border-steel-200 bg-white' : 'border-danger-300 bg-danger-50'}`}>
            <p className="text-sm font-semibold text-carbon">
              {suspendida ? t('platform.show.reactivate') : t('platform.show.suspend')}
            </p>

            {! suspendida ? (
              <p className="mt-1 text-sm text-danger-700">{t('platform.show.suspendWarning')}</p>
            ) : null}

            {abierto ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  form.post(`/platform/tenants/${tenant.id}/suspension`, {
                    preserveScroll: true,
                    onSuccess: () => { form.reset(); setAbierto(false) },
                  })
                }}
                className="mt-3 flex flex-col gap-2"
              >
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-steel-700">{t('platform.show.reason')}</span>
                  <textarea
                    rows={2}
                    value={form.data.reason}
                    onChange={(e) => form.setData('reason', e.target.value)}
                    className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500"
                  />
                  <span className="text-xs text-steel-600">{t('platform.show.reasonHint')}</span>
                </label>

                {form.errors.reason ? (
                  <p role="alert" className="text-sm text-danger-700">{form.errors.reason}</p>
                ) : null}

                <div>
                  <button
                    type="submit"
                    disabled={form.processing}
                    className={`rounded px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${
                      suspendida ? 'bg-navy-700 hover:bg-navy-800' : 'bg-danger-600 hover:bg-danger-700'
                    }`}
                  >
                    {t('platform.show.confirm')}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAbierto(true)}
                className="mt-3 rounded border border-steel-300 bg-white px-3 py-1.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
              >
                {suspendida ? t('platform.show.reactivate') : t('platform.show.suspend')}
              </button>
            )}
          </div>
        ) : null}

        <div>
          <Link href="/platform/tenants" className="text-sm text-navy-700 underline">
            {t('platform.show.back')}
          </Link>
        </div>
      </div>
    </AppLayout>
  )
}

function Consumo({ label, uso }: { label: string; uso: Uso }) {
  const { t } = useI18n()
  const pasado = uso.limit !== null && uso.used > uso.limit

  return (
    <div className={`rounded border p-3 ${pasado ? 'border-warning-300 bg-warning-50' : 'border-steel-200'}`}>
      <p className="text-xs uppercase tracking-wide text-steel-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-carbon">{uso.used}</p>
      <p className="text-xs text-steel-600">
        {uso.limit === null ? t('platform.show.noLimit') : t('platform.show.of', { n: String(uso.limit) })}
      </p>
    </div>
  )
}

function Dato({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-steel-600">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-carbon ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  )
}

/**
 * El interruptor del bloqueo, con su freno.
 *
 * Encenderlo sobre una empresa que ya está por encima de un tope le corta las
 * altas a la primera. Por eso el botón no está: el servidor se niega igual
 * —nunca se confía en el cliente— y la pantalla dice cuál es el recurso que
 * sobra, para que la conversación con el cliente pase ANTES que el muro.
 */
function Bloqueo({
  tenant, usage,
}: {
  tenant: { id: string; limitsEnforcedAt: string | null }
  usage: { users: Uso; carriers: Uso; loadsThisMonth: Uso }
}) {
  const { t } = useI18n()
  const form = useForm({ action: tenant.limitsEnforcedAt === null ? 'enforce' : 'relax' })

  const excedidos = (Object.entries(usage) as [string, Uso][])
    .filter(([, u]) => u.limit !== null && u.used > u.limit)
    .map(([k]) => t(`billing.limits.${k}`))

  const aplicando = tenant.limitsEnforcedAt !== null
  const bloqueado = ! aplicando && excedidos.length > 0

  return (
    <div className="mt-4 border-t border-steel-100 pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-steel-600">
        {t('platform.limits.title')}
      </p>
      <p className="mt-1 text-sm text-steel-700">
        {aplicando
          ? t('platform.limits.enforcedSince', { date: tenant.limitsEnforcedAt ?? '' })
          : t('platform.limits.notEnforced')}
      </p>

      {bloqueado ? (
        <p className="mt-2 rounded border border-warning-300 bg-warning-50 p-2 text-sm text-carbon">
          {t('platform.limits.refusedOver', { resources: excedidos.join(', ') })}
        </p>
      ) : (
        <button
          type="button"
          disabled={form.processing}
          onClick={() => form.post(`/platform/tenants/${tenant.id}/limits`, { preserveScroll: true })}
          className="mt-2 rounded border border-steel-300 bg-white px-3 py-1.5 text-sm font-medium text-carbon transition hover:bg-steel-50 disabled:opacity-50"
        >
          {aplicando ? t('platform.limits.relax') : t('platform.limits.enforce')}
        </button>
      )}
    </div>
  )
}
