import { useForm } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

interface Plan {
  id: string
  code: string
  nameEn: string
  nameEs: string
  monthlyPriceCents: number
  trialDays: number
  maxUsers: number | null
  maxCarriers: number | null
  maxLoadsPerMonth: number | null
  isPublic: boolean
  stripePriceId: string | null
  tenants: number
}

interface Props {
  plans: Plan[]
  can: { manage: boolean }
}

export default function PlatformPlans({ plans, can }: Props) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t('platform.plans.title')}
      description={t('platform.plans.subtitle')}
      crumbs={[{ label: t('platform.plans.title') }]}
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-steel-600">
          {t('platform.plans.codeLocked')} {t('platform.plans.priceNote')}
        </p>

        {! can.manage ? (
          <p className="rounded border border-dashed border-steel-300 bg-white p-4 text-sm text-steel-700">
            {t('platform.plans.readOnly')}
          </p>
        ) : null}

        {plans.map((p) => (
          <Tarjeta key={p.id} plan={p} editable={can.manage} />
        ))}
      </div>
    </AppLayout>
  )
}

function Tarjeta({ plan, editable }: { plan: Plan; editable: boolean }) {
  const { t, locale } = useI18n()

  const form = useForm({
    monthly_price_cents: String(plan.monthlyPriceCents),
    trial_days: String(plan.trialDays),
    max_users: plan.maxUsers === null ? '' : String(plan.maxUsers),
    max_carriers: plan.maxCarriers === null ? '' : String(plan.maxCarriers),
    max_loads_per_month: plan.maxLoadsPerMonth === null ? '' : String(plan.maxLoadsPerMonth),
    is_public: plan.isPublic,
  })

  return (
    <div className="rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-carbon">
            {locale === 'es' ? plan.nameEs : plan.nameEn}
            <span className="ml-2 font-mono text-xs text-steel-600">{plan.code}</span>
          </p>
          <p className="mt-0.5 text-xs text-steel-600">
            {t('platform.plans.tenants')}: {plan.tenants}
            {plan.stripePriceId ? ` · ${t('platform.plans.stripePrice')}: ${plan.stripePriceId}` : ''}
          </p>
        </div>
        <p className="text-lg font-semibold tabular-nums text-navy-700">
          {formatCents(plan.monthlyPriceCents, locale)}
        </p>
      </div>

      {editable ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            // `transform()` devuelve void: NO se puede encadenar `.patch()`
            // detrás. Ya rompió la edición de una empresa de factoring en un
            // lote anterior y lo pilló `tsc`, no el navegador.
            //
            // Los topes en blanco viajan como null, que en el esquema significa
            // «sin tope». Mandarlos como cadena vacía los convertiría en cero.
            form.transform((d) => ({
              ...d,
              max_users: d.max_users === '' ? null : Number(d.max_users),
              max_carriers: d.max_carriers === '' ? null : Number(d.max_carriers),
              max_loads_per_month: d.max_loads_per_month === '' ? null : Number(d.max_loads_per_month),
              monthly_price_cents: Number(d.monthly_price_cents),
              trial_days: Number(d.trial_days),
            }))
            form.patch(`/platform/plans/${plan.id}`, { preserveScroll: true })
          }}
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-steel-100 pt-3"
        >
          <Campo label={t('platform.plans.monthly')}>
            <input
              type="number"
              min="0"
              value={form.data.monthly_price_cents}
              onChange={(e) => form.setData('monthly_price_cents', e.target.value)}
              className={CAMPO}
            />
          </Campo>
          <Campo label={t('platform.plans.trialDays')}>
            <input
              type="number"
              min="0"
              value={form.data.trial_days}
              onChange={(e) => form.setData('trial_days', e.target.value)}
              className={CAMPO}
            />
          </Campo>
          <Campo label={t('platform.plans.maxUsers')} hint={t('platform.plans.blank')}>
            <input
              type="number"
              min="1"
              value={form.data.max_users}
              onChange={(e) => form.setData('max_users', e.target.value)}
              className={CAMPO}
            />
          </Campo>
          <Campo label={t('platform.plans.maxCarriers')} hint={t('platform.plans.blank')}>
            <input
              type="number"
              min="1"
              value={form.data.max_carriers}
              onChange={(e) => form.setData('max_carriers', e.target.value)}
              className={CAMPO}
            />
          </Campo>
          <Campo label={t('platform.plans.maxLoads')} hint={t('platform.plans.blank')}>
            <input
              type="number"
              min="1"
              value={form.data.max_loads_per_month}
              onChange={(e) => form.setData('max_loads_per_month', e.target.value)}
              className={CAMPO}
            />
          </Campo>

          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={form.data.is_public}
              onChange={(e) => form.setData('is_public', e.target.checked)}
              className="h-4 w-4"
            />
            {t('platform.plans.isPublic')}
          </label>

          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {t('platform.plans.save')}
          </button>

          {Object.values(form.errors).length > 0 ? (
            <p role="alert" className="w-full text-sm text-danger-700">
              {Object.values(form.errors)[0]}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}

const CAMPO =
  'w-32 rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-steel-700">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-steel-600">{hint}</span> : null}
    </label>
  )
}
