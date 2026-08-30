import { useForm } from '@inertiajs/react'
import { CountryStateFields } from '@/components/Form/CountryStateFields'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

interface Settings {
  dispatch_fee_base: string
  default_carrier_dispatch_fee_bps: number
  default_dispatcher_commission_bps: number
  dispatcher_commission_basis: string
  default_payment_terms_days: number
  load_number_prefix: string
  invoice_number_prefix: string
  document_expiration_warning_days: number
  fmcsa_reverification_days: number
  allow_dispatcher_resource_assignment: boolean
  require_oversize_admin_validation: boolean
  public_tracking_enabled: boolean
  public_tracking_token_ttl_hours: number
  contact_phone: string | null
  contact_email: string | null
  support_email: string | null
  address_line1: string | null
  address_line2: string | null
  address_city: string | null
  address_country: string
  address_state: string | null
  address_postal_code: string | null
  [key: string]: string | number | boolean | null
}

interface Subscription {
  status: string
  planCode: string | null
  planNameEn: string | null
  planNameEs: string | null
  monthlyPriceCents: number | null
  trialEndsOn: string | null
  periodEndsOn: string | null
  cancelAtPeriodEnd: boolean
}

interface Props {
  settings: Settings
  subscription: Subscription | null
  readOnly: {
    loadNextSequence: number
    invoiceNextSequence: number
    operationalActiveMonths: number
    operationalPurgeYears: number
    financialRetentionYears: number
  }
  feeBases: string[]
  commissionBases: string[]
  can: { update: boolean }
}

export default function SettingsIndex({ settings, subscription = null, readOnly, feeBases, commissionBases, can }: Props) {
  const { t } = useI18n()
  const form = useForm<Settings>({ ...settings })

  const bloqueado = ! can.update

  return (
    <AppLayout
      title={t('settings.index.title')}
      description={t('settings.index.subtitle')}
      crumbs={[{ label: t('settings.index.title') }]}
    >
      <Plan subscription={subscription} />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.patch('/settings', { preserveScroll: true })
        }}
        className="flex max-w-3xl flex-col gap-6"
      >
        <Seccion titulo={t('settings.money.title')} nota={t('settings.money.note')}>
          <Campo label={t('settings.money.feeBase')} error={form.errors.dispatch_fee_base} hint={t(`settings.feeBase.${form.data.dispatch_fee_base}`)}>
            <select
              disabled={bloqueado}
              value={form.data.dispatch_fee_base}
              onChange={(e) => form.setData('dispatch_fee_base', e.target.value)}
              className={CAMPO}
            >
              {feeBases.map((b) => (
                <option key={b} value={b}>{t(`settings.feeBaseLabel.${b}`)}</option>
              ))}
            </select>
          </Campo>

          <Porcentaje
            label={t('settings.money.dispatchFee')}
            hint={t('settings.money.dispatchFeeHint')}
            bps={form.data.default_carrier_dispatch_fee_bps}
            onChange={(v) => form.setData('default_carrier_dispatch_fee_bps', v)}
            error={form.errors.default_carrier_dispatch_fee_bps}
            disabled={bloqueado}
          />

          <Porcentaje
            label={t('settings.money.commission')}
            hint={t('settings.money.commissionHint')}
            bps={form.data.default_dispatcher_commission_bps}
            onChange={(v) => form.setData('default_dispatcher_commission_bps', v)}
            error={form.errors.default_dispatcher_commission_bps}
            disabled={bloqueado}
          />

          <Campo label={t('settings.money.commissionBasis')} error={form.errors.dispatcher_commission_basis}>
            <select
              disabled={bloqueado}
              value={form.data.dispatcher_commission_basis}
              onChange={(e) => form.setData('dispatcher_commission_basis', e.target.value)}
              className={CAMPO}
            >
              {commissionBases.map((b) => (
                <option key={b} value={b}>{t(`settings.commissionBasis.${b}`)}</option>
              ))}
            </select>
          </Campo>

          <Numero
            label={t('settings.money.paymentTerms')}
            value={form.data.default_payment_terms_days}
            onChange={(v) => form.setData('default_payment_terms_days', v)}
            error={form.errors.default_payment_terms_days}
            disabled={bloqueado}
            min={0}
            max={365}
          />
        </Seccion>

        <Seccion titulo={t('settings.numbering.title')} nota={t('settings.numbering.note')}>
          <Campo label={t('settings.numbering.loadPrefix')} error={form.errors.load_number_prefix}>
            <input
              type="text"
              disabled={bloqueado}
              maxLength={12}
              value={form.data.load_number_prefix}
              onChange={(e) => form.setData('load_number_prefix', e.target.value.toUpperCase())}
              className={CAMPO}
            />
          </Campo>
          <Campo label={t('settings.numbering.invoicePrefix')} error={form.errors.invoice_number_prefix}>
            <input
              type="text"
              disabled={bloqueado}
              maxLength={12}
              value={form.data.invoice_number_prefix}
              onChange={(e) => form.setData('invoice_number_prefix', e.target.value.toUpperCase())}
              className={CAMPO}
            />
          </Campo>

          {/* Los contadores se enseñan y NO se editan: bajarlos repetiría
              números de factura ya emitidos, y dos facturas con el mismo número
              es un problema contable, no una molestia. */}
          <p className="sm:col-span-2 text-xs text-steel-600">
            {t('settings.numbering.counters', {
              load: String(readOnly.loadNextSequence),
              invoice: String(readOnly.invoiceNextSequence),
            })}
          </p>
        </Seccion>

        <Seccion titulo={t('settings.ops.title')}>
          <Numero
            label={t('settings.ops.docWarning')}
            hint={t('settings.ops.docWarningHint')}
            value={form.data.document_expiration_warning_days}
            onChange={(v) => form.setData('document_expiration_warning_days', v)}
            error={form.errors.document_expiration_warning_days}
            disabled={bloqueado}
            min={1}
            max={365}
          />
          <Numero
            label={t('settings.ops.fmcsaDays')}
            value={form.data.fmcsa_reverification_days}
            onChange={(v) => form.setData('fmcsa_reverification_days', v)}
            error={form.errors.fmcsa_reverification_days}
            disabled={bloqueado}
            min={1}
            max={365}
          />
          <Numero
            label={t('settings.ops.trackingTtl')}
            value={form.data.public_tracking_token_ttl_hours}
            onChange={(v) => form.setData('public_tracking_token_ttl_hours', v)}
            error={form.errors.public_tracking_token_ttl_hours}
            disabled={bloqueado}
            min={1}
            max={720}
          />

          <div className="sm:col-span-2 flex flex-col gap-2">
            <Casilla
              label={t('settings.ops.dispatcherAssign')}
              hint={t('settings.ops.dispatcherAssignHint')}
              checked={form.data.allow_dispatcher_resource_assignment}
              onChange={(v) => form.setData('allow_dispatcher_resource_assignment', v)}
              disabled={bloqueado}
            />
            <Casilla
              label={t('settings.ops.oversizeAdmin')}
              checked={form.data.require_oversize_admin_validation}
              onChange={(v) => form.setData('require_oversize_admin_validation', v)}
              disabled={bloqueado}
            />
            <Casilla
              label={t('settings.ops.publicTracking')}
              checked={form.data.public_tracking_enabled}
              onChange={(v) => form.setData('public_tracking_enabled', v)}
              disabled={bloqueado}
            />
          </div>
        </Seccion>

        <Seccion titulo={t('settings.contact.title')} nota={t('settings.contact.note')}>
          <Campo label={t('settings.contact.phone')} error={form.errors.contact_phone}>
            <input type="tel" disabled={bloqueado} maxLength={32} value={form.data.contact_phone ?? ''}
              onChange={(e) => form.setData('contact_phone', e.target.value)} className={CAMPO} />
          </Campo>
          <Campo label={t('settings.contact.email')} error={form.errors.contact_email}>
            <input type="email" disabled={bloqueado} maxLength={255} value={form.data.contact_email ?? ''}
              onChange={(e) => form.setData('contact_email', e.target.value)} className={CAMPO} />
          </Campo>
          <Campo label={t('settings.contact.support')} error={form.errors.support_email}>
            <input type="email" disabled={bloqueado} maxLength={255} value={form.data.support_email ?? ''}
              onChange={(e) => form.setData('support_email', e.target.value)} className={CAMPO} />
          </Campo>
          <Campo label={t('settings.contact.line1')} error={form.errors.address_line1}>
            <input type="text" disabled={bloqueado} maxLength={200} value={form.data.address_line1 ?? ''}
              onChange={(e) => form.setData('address_line1', e.target.value)} className={CAMPO} />
          </Campo>
          <Campo label={t('settings.contact.line2')} error={form.errors.address_line2}>
            <input type="text" disabled={bloqueado} maxLength={200} value={form.data.address_line2 ?? ''}
              onChange={(e) => form.setData('address_line2', e.target.value)} className={CAMPO} />
          </Campo>
          <Campo label={t('settings.contact.city')} error={form.errors.address_city}>
            <input type="text" disabled={bloqueado} maxLength={120} value={form.data.address_city ?? ''}
              onChange={(e) => form.setData('address_city', e.target.value)} className={CAMPO} />
          </Campo>

          <CountryStateFields
            country={form.data.address_country}
            state={form.data.address_state ?? ''}
            onChange={(next) => {
              form.setData((d) => ({ ...d, address_country: next.country, address_state: next.state }))
            }}
            countryError={form.errors.address_country}
            stateError={form.errors.address_state}
            disabled={bloqueado}
          />

          <Campo label={t('settings.contact.postal')} error={form.errors.address_postal_code}>
            <input type="text" disabled={bloqueado} maxLength={12} value={form.data.address_postal_code ?? ''}
              onChange={(e) => form.setData('address_postal_code', e.target.value)} className={CAMPO} />
          </Campo>
        </Seccion>

        {/* La retención se enseña y no se edita: cambiarla tiene consecuencias
            legales y no debería ser un campo más de un formulario. */}
        <div className="rounded border border-steel-200 bg-steel-50 p-4 text-xs text-steel-700">
          {t('settings.retention.note', {
            months: String(readOnly.operationalActiveMonths),
            purge: String(readOnly.operationalPurgeYears),
            financial: String(readOnly.financialRetentionYears),
          })}
        </div>

        {can.update ? (
          <div>
            <button
              type="submit"
              disabled={form.processing}
              className="rounded bg-safety-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:opacity-50"
            >
              {form.processing ? t('common.states.saving') : t('settings.index.save')}
            </button>
          </div>
        ) : null}
      </form>
    </AppLayout>
  )
}

const CAMPO =
  'w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200 disabled:bg-steel-50'

function Seccion({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-steel-200 bg-white p-5">
      <h2 className="uppercase-heading text-xs text-safety-600">{titulo}</h2>
      {nota ? <p className="mt-1 text-xs text-steel-600">{nota}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function Campo({
  label, hint, error, children,
}: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-carbon">{label}</span>
      {children}
      {hint && ! error ? <span className="text-xs text-steel-600">{hint}</span> : null}
      {error ? <span role="alert" className="text-sm text-danger-700">{error}</span> : null}
    </label>
  )
}

/** Porcentaje en pantalla, puntos básicos por dentro. */
function Porcentaje({
  label, hint, bps, onChange, error, disabled,
}: {
  label: string; hint?: string; bps: number
  onChange: (v: number) => void; error?: string; disabled: boolean
}) {
  return (
    <Campo label={label} hint={hint} error={error}>
      <input
        type="number"
        min={0}
        max={100}
        step={0.25}
        disabled={disabled}
        value={bps / 100}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Math.round(Number(e.target.value) * 100))}
        className={CAMPO}
      />
    </Campo>
  )
}

function Numero({
  label, hint, value, onChange, error, disabled, min, max,
}: {
  label: string; hint?: string; value: number
  onChange: (v: number) => void; error?: string; disabled: boolean; min: number; max: number
}) {
  return (
    <Campo label={label} hint={hint} error={error}>
      <input
        type="number"
        min={min}
        max={max}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? min : Number(e.target.value))}
        className={CAMPO}
      />
    </Campo>
  )
}

function Casilla({
  label, hint, checked, onChange, disabled,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 rounded border-steel-300"
      />
      <span>
        <span className="text-sm text-carbon">{label}</span>
        {hint ? <span className="block text-xs text-steel-600">{hint}</span> : null}
      </span>
    </label>
  )
}

/**
 * El plan de esta empresa, de solo lectura.
 *
 * `tenant_subscriptions` se escribía al darse de alta y no la leía nadie: ni la
 * plataforma ni la propia empresa. Alguien podía estar en un periodo de prueba a
 * punto de acabarse sin tener dónde comprobarlo.
 *
 * No hay botón de cambiar de plan a propósito: cambiar de plan pasa por cobrar,
 * y el cobro todavía no está conectado. Un botón que no cobra es peor que no
 * tener botón.
 */
function Plan({ subscription }: { subscription: Subscription | null }) {
  const { t, locale } = useI18n()

  if (subscription === null) {
    return (
      <p className="rounded border border-dashed border-steel-300 bg-white p-4 text-sm text-steel-700">
        {t('settings.subscription.none')}
      </p>
    )
  }

  const nombre =
    (locale === 'es' ? subscription.planNameEs : subscription.planNameEn) ?? subscription.planCode ?? '—'

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-carbon">{t('settings.subscription.title')}</p>
        <p className="text-xs text-steel-600">{t('settings.subscription.hint')}</p>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-steel-600">
            {t('settings.subscription.plan')}
          </dt>
          <dd className="mt-0.5 text-sm font-medium text-carbon">{nombre}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-steel-600">
            {t('settings.subscription.status')}
          </dt>
          <dd className="mt-0.5 text-sm text-carbon">
            {t(`platform.status.${subscription.status}`)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-steel-600">
            {t('settings.subscription.monthly')}
          </dt>
          <dd className="mt-0.5 text-sm tabular-nums text-carbon">
            {subscription.monthlyPriceCents === null
              ? '—'
              : formatCents(subscription.monthlyPriceCents, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-steel-600">
            {subscription.status === 'trialing'
              ? t('settings.subscription.trialEnds')
              : t('settings.subscription.periodEnds')}
          </dt>
          <dd className="mt-0.5 text-sm tabular-nums text-carbon">
            {(subscription.status === 'trialing' ? subscription.trialEndsOn : subscription.periodEndsOn) ?? '—'}
          </dd>
        </div>
      </dl>

      {subscription.cancelAtPeriodEnd ? (
        <p className="mt-3 text-sm text-warning-800">{t('settings.subscription.cancelling')}</p>
      ) : null}
    </section>
  )
}
