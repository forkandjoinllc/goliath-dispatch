import { useForm, usePage } from '@inertiajs/react'
import { CountryStateFields } from '@/components/Form/CountryStateFields'
import { Button, FormActions } from '@/components/Ui/Button'
import { Checkbox, ReadOnly, SelectInput, TextInput } from '@/components/Ui/Field'
import { Card, CardHeader, FieldGrid, Note, Wide } from '@/components/Ui/Surface'
import { TabPanel, Tabs } from '@/components/Ui/Tabs'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import type { SharedProps } from '@/types'

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
  /**
   * Si la revalidación de FMCSA está pasando de verdad.
   *
   * El campo de al lado acepta un número de días y, sin proveedor conectado,
   * ese número no gobierna nada. La pantalla donde se toma la decisión tiene
   * que decir si la decisión tiene efecto.
   */
  revalidation: {
    days: number
    providerLive: boolean
    lastVerifiedAt: string | null
    dueCount: number
  }
  readOnly: {
    loadNextSequence: number
    invoiceNextSequence: number
    operationalActiveMonths: number
    operationalPurgeYears: number
    financialRetentionYears: number
  }
  feeBases: string[]
  commissionBases: string[]
  branding: {
    name: string
    logoUrl: string | null
    primaryColor: string
    accentColor: string
    emailFooter: string | null
  }
  templates: {
    event: string
    locale: string
    subject: string | null
    body: string | null
    tokens: string[]
  }[]
  /**
   * El webhook del alta, y si algo lo está entregando.
   *
   * Lo segundo importa tanto como lo primero: una casilla «Activado» sin el
   * cron de Forge puesto no manda nada, y la pantalla tiene que poder decir la
   * diferencia entre «no se ha dado nadie de alta» y «no está corriendo nada».
   */
  webhook: {
    enabled: boolean
    url: string | null
    secretLast4: string | null
    sweepLastRunAt: string | null
    sweepStalled: boolean
    pending: number
    abandoned: number
    last: Entrega | null
    recent: Entrega[]
  }
  /** Se enseña UNA vez, al crearlo, y nunca más. */
  webhookSecretOnce?: string | null
  /** Las pestañas que pinta la pantalla, en orden, declaradas en el servidor. */
  tabs: string[]
  /** La que está abierta. Sale de la URL y la valida el servidor. */
  tab: string
  can: { update: boolean }
}

interface Entrega {
  id: string
  event: string
  status: string
  attempts: number
  responseStatus: number | null
  error: string | null
  isTest: boolean
  createdAt: string
  lastAttemptAt: string | null
  nextAttemptAt: string | null
}

/**
 * `tracking.link` → `trackingLink`, que es la clave del diccionario.
 *
 * El evento lleva un PUNTO, y `t()` parte las claves por puntos: buscar
 * `settings.brand.templates.tracking.link` es bajar por
 * `settings → brand → templates → tracking`, que no existe. La clave se
 * devolvía tal cual y esta pantalla enseñaba
 * «SETTINGS.BRAND.TEMPLATES.TRACKING.LINK» en mayúsculas, con la traducción
 * escrita en los dos idiomas y sin usarse nunca.
 *
 * Misma forma que el `camel()` de nav.status, ampliada al punto.
 */
function claveDeEvento(evento: string): string {
  return evento.replace(/[._]([a-z])/g, (_, c: string) => c.toUpperCase())
}

export default function SettingsIndex({
  settings,
  subscription = null,
  revalidation,
  readOnly,
  feeBases,
  commissionBases,
  branding,
  templates,
  webhook,
  webhookSecretOnce = null,
  tabs,
  tab,
  can,
}: Props) {
  const { t } = useI18n()
  const bloqueado = ! can.update

  /*
   * Los errores que vuelven del servidor, para marcar la pestaña.
   *
   * Vienen en la bolsa compartida de Inertia y no en el `useForm` de cada
   * sección: la respuesta con errores llega a la página, y para entonces el
   * formulario que la provocó puede no estar montado —quien guardó «Contacto» y
   * cambió de pestaña mientras tanto—. Sin esto, ese error no se vería en
   * ningún sitio: ni en la sección, que no está en pantalla, ni en la pestaña,
   * que no sabría que tiene uno.
   */
  const { errors } = usePage<SharedProps & { errors: Record<string, string> }>().props
  const conErrores = Object.keys(errors ?? {})

  const DE_LA_PESTANA: Record<string, string[]> = {
    money: [
      'dispatch_fee_base', 'default_carrier_dispatch_fee_bps',
      'default_dispatcher_commission_bps', 'dispatcher_commission_basis',
      'default_payment_terms_days',
    ],
    numbering: ['load_number_prefix', 'invoice_number_prefix'],
    ops: [
      'document_expiration_warning_days', 'fmcsa_reverification_days',
      'allow_dispatcher_resource_assignment', 'require_oversize_admin_validation',
      'public_tracking_enabled', 'public_tracking_token_ttl_hours',
    ],
    contact: [
      'contact_phone', 'contact_email', 'support_email', 'address_line1',
      'address_line2', 'address_city', 'address_country', 'address_state',
      'address_postal_code',
    ],
    brand: ['logo', 'primary_color', 'accent_color', 'email_footer'],
    webhook: [
      'carrier_signup_webhook_url', 'carrier_signup_webhook_secret',
      'carrier_signup_webhook_enabled',
    ],
  }

  return (
    <AppLayout
      title={t('settings.index.title')}
      description={t('settings.index.subtitle')}
      crumbs={[{ label: t('settings.index.title') }]}
    >
      <Plan subscription={subscription} />

      <div className="mt-6">
        <Tabs
          active={tab}
          tabs={tabs.map((id) => ({
            id,
            label: t(`settings.tabs.${id}`),
            invalid: (DE_LA_PESTANA[id] ?? []).some((campo) => conErrores.includes(campo)),
          }))}
        />

        <TabPanel active={tab}>
          <div className="max-w-3xl">
            {tab === 'money' ? (
              <SeccionDinero
                settings={settings}
                feeBases={feeBases}
                commissionBases={commissionBases}
                bloqueado={bloqueado}
              />
            ) : null}

            {tab === 'numbering' ? (
              <SeccionNumeracion settings={settings} readOnly={readOnly} bloqueado={bloqueado} />
            ) : null}

            {tab === 'ops' ? (
              <SeccionOperacion
                settings={settings}
                revalidation={revalidation}
                readOnly={readOnly}
                bloqueado={bloqueado}
              />
            ) : null}

            {tab === 'contact' ? (
              <SeccionContacto settings={settings} bloqueado={bloqueado} />
            ) : null}

            {tab === 'brand' ? (
              <Marca branding={branding} templates={templates} bloqueado={bloqueado} />
            ) : null}

            {tab === 'webhook' ? (
              <Webhook estado={webhook} secretoUnaVez={webhookSecretOnce} bloqueado={bloqueado} />
            ) : null}
          </div>
        </TabPanel>
      </div>
    </AppLayout>
  )
}

/**
 * El pie de guardar de una sección.
 *
 * Dice EN QUÉ sección está el botón. «Guardar» a secas, debajo de una pestaña,
 * no contesta la pregunta que se hace quien ha tocado dos pestañas: ¿esto
 * guarda lo de aquí o lo de todas?
 */
function Guardar({
  procesando,
  bloqueado,
  nota,
}: {
  procesando: boolean
  bloqueado: boolean
  nota: string
}) {
  const { t } = useI18n()

  if (bloqueado) {
    return (
      <FormActions note={t('settings.index.readOnly')}>
        <span />
      </FormActions>
    )
  }

  return (
    <FormActions note={nota}>
      <Button type="submit" weight="primary" disabled={procesando}>
        {procesando ? t('common.states.saving') : t('settings.index.save')}
      </Button>
    </FormActions>
  )
}

/* ── Dinero ─────────────────────────────────────────────────────────────── */

function SeccionDinero({
  settings,
  feeBases,
  commissionBases,
  bloqueado,
}: {
  settings: Settings
  feeBases: string[]
  commissionBases: string[]
  bloqueado: boolean
}) {
  const { t } = useI18n()

  /*
   * Un `useForm` por sección, con SOLO los campos de esa sección.
   *
   * No es una comodidad: es la otra mitad de «lo que ve es lo que guarda». Con
   * un formulario único, pulsar «Guardar» en Dinero mandaría también lo que
   * hubiera escrito sin guardar en Contacto — invisible para quien pulsa.
   */
  const form = useForm({
    section: 'money',
    dispatch_fee_base: settings.dispatch_fee_base,
    default_carrier_dispatch_fee_bps: settings.default_carrier_dispatch_fee_bps,
    default_dispatcher_commission_bps: settings.default_dispatcher_commission_bps,
    dispatcher_commission_basis: settings.dispatcher_commission_basis,
    default_payment_terms_days: settings.default_payment_terms_days,
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.patch('/settings', { preserveScroll: true }) }}>
      <Card>
        <CardHeader title={t('settings.money.title')} note={t('settings.money.note')} />

        <FieldGrid>
          <SelectInput
            label={t('settings.money.feeBase')}
            hint={t(`settings.feeBase.${form.data.dispatch_fee_base}`)}
            error={form.errors.dispatch_fee_base}
            disabled={bloqueado}
            value={form.data.dispatch_fee_base}
            onChange={(e) => form.setData('dispatch_fee_base', e.target.value)}
          >
            {feeBases.map((b) => (
              <option key={b} value={b}>{t(`settings.feeBaseLabel.${b}`)}</option>
            ))}
          </SelectInput>

          <SelectInput
            label={t('settings.money.commissionBasis')}
            error={form.errors.dispatcher_commission_basis}
            disabled={bloqueado}
            value={form.data.dispatcher_commission_basis}
            onChange={(e) => form.setData('dispatcher_commission_basis', e.target.value)}
          >
            {commissionBases.map((b) => (
              <option key={b} value={b}>{t(`settings.commissionBasis.${b}`)}</option>
            ))}
          </SelectInput>

          <TextInput
            type="number"
            min={0}
            max={100}
            step={0.25}
            label={t('settings.money.dispatchFee')}
            hint={t('settings.money.dispatchFeeHint')}
            error={form.errors.default_carrier_dispatch_fee_bps}
            disabled={bloqueado}
            value={form.data.default_carrier_dispatch_fee_bps / 100}
            onChange={(e) => form.setData(
              'default_carrier_dispatch_fee_bps',
              e.target.value === '' ? 0 : Math.round(Number(e.target.value) * 100),
            )}
          />

          <TextInput
            type="number"
            min={0}
            max={100}
            step={0.25}
            label={t('settings.money.commission')}
            hint={t('settings.money.commissionHint')}
            error={form.errors.default_dispatcher_commission_bps}
            disabled={bloqueado}
            value={form.data.default_dispatcher_commission_bps / 100}
            onChange={(e) => form.setData(
              'default_dispatcher_commission_bps',
              e.target.value === '' ? 0 : Math.round(Number(e.target.value) * 100),
            )}
          />

          <TextInput
            type="number"
            min={0}
            max={365}
            label={t('settings.money.paymentTerms')}
            error={form.errors.default_payment_terms_days}
            disabled={bloqueado}
            value={form.data.default_payment_terms_days}
            onChange={(e) => form.setData(
              'default_payment_terms_days',
              e.target.value === '' ? 0 : Number(e.target.value),
            )}
          />
        </FieldGrid>

        <Guardar procesando={form.processing} bloqueado={bloqueado} nota={t('settings.money.saveNote')} />
      </Card>
    </form>
  )
}

/* ── Numeración ─────────────────────────────────────────────────────────── */

function SeccionNumeracion({
  settings,
  readOnly,
  bloqueado,
}: {
  settings: Settings
  readOnly: Props['readOnly']
  bloqueado: boolean
}) {
  const { t } = useI18n()

  const form = useForm({
    section: 'numbering',
    load_number_prefix: settings.load_number_prefix,
    invoice_number_prefix: settings.invoice_number_prefix,
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.patch('/settings', { preserveScroll: true }) }}>
      <Card>
        <CardHeader title={t('settings.numbering.title')} note={t('settings.numbering.note')} />

        <FieldGrid>
          <TextInput
            label={t('settings.numbering.loadPrefix')}
            error={form.errors.load_number_prefix}
            disabled={bloqueado}
            maxLength={12}
            value={form.data.load_number_prefix}
            onChange={(e) => form.setData('load_number_prefix', e.target.value.toUpperCase())}
          />
          <TextInput
            label={t('settings.numbering.invoicePrefix')}
            error={form.errors.invoice_number_prefix}
            disabled={bloqueado}
            maxLength={12}
            value={form.data.invoice_number_prefix}
            onChange={(e) => form.setData('invoice_number_prefix', e.target.value.toUpperCase())}
          />

          {/* Los contadores se ENSEÑAN y no se editan: bajarlos repetiría
              números de factura ya emitidos, y dos facturas con el mismo número
              es un problema contable, no una molestia. Van como dato y no como
              campo desactivado, que invita a pulsarlo. */}
          <ReadOnly
            label={t('settings.numbering.nextLoad')}
            value={String(readOnly.loadNextSequence)}
          />
          <ReadOnly
            label={t('settings.numbering.nextInvoice')}
            value={String(readOnly.invoiceNextSequence)}
            hint={t('settings.numbering.countersHint')}
          />
        </FieldGrid>

        <Guardar procesando={form.processing} bloqueado={bloqueado} nota={t('settings.numbering.saveNote')} />
      </Card>
    </form>
  )
}

/* ── Operación ──────────────────────────────────────────────────────────── */

function SeccionOperacion({
  settings,
  revalidation,
  readOnly,
  bloqueado,
}: {
  settings: Settings
  revalidation: Props['revalidation']
  readOnly: Props['readOnly']
  bloqueado: boolean
}) {
  const { t } = useI18n()

  const form = useForm({
    section: 'ops',
    document_expiration_warning_days: settings.document_expiration_warning_days,
    fmcsa_reverification_days: settings.fmcsa_reverification_days,
    allow_dispatcher_resource_assignment: settings.allow_dispatcher_resource_assignment,
    require_oversize_admin_validation: settings.require_oversize_admin_validation,
    public_tracking_enabled: settings.public_tracking_enabled,
    public_tracking_token_ttl_hours: settings.public_tracking_token_ttl_hours,
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.patch('/settings', { preserveScroll: true }) }}>
      <Card>
        <CardHeader title={t('settings.ops.title')} />

        <FieldGrid>
          <TextInput
            type="number"
            min={1}
            max={365}
            label={t('settings.ops.docWarning')}
            hint={t('settings.ops.docWarningHint')}
            error={form.errors.document_expiration_warning_days}
            disabled={bloqueado}
            value={form.data.document_expiration_warning_days}
            onChange={(e) => form.setData(
              'document_expiration_warning_days',
              e.target.value === '' ? 1 : Number(e.target.value),
            )}
          />

          <TextInput
            type="number"
            min={1}
            max={720}
            label={t('settings.ops.trackingTtl')}
            error={form.errors.public_tracking_token_ttl_hours}
            disabled={bloqueado}
            value={form.data.public_tracking_token_ttl_hours}
            onChange={(e) => form.setData(
              'public_tracking_token_ttl_hours',
              e.target.value === '' ? 1 : Number(e.target.value),
            )}
          />

          <Wide>
            <div className="flex flex-col gap-2">
              <TextInput
                type="number"
                min={1}
                max={365}
                label={t('settings.ops.fmcsaDays')}
                error={form.errors.fmcsa_reverification_days}
                disabled={bloqueado}
                value={form.data.fmcsa_reverification_days}
                onChange={(e) => form.setData(
                  'fmcsa_reverification_days',
                  e.target.value === '' ? 1 : Number(e.target.value),
                )}
              />

              {/* Las DOS cosas por separado, y no un semáforo: que haya
                  proveedor conectado no garantiza que el planificador esté
                  corriendo. */}
              {revalidation.providerLive ? (
                <p className="text-xs text-steel-600">
                  {revalidation.lastVerifiedAt === null
                    ? t('settings.ops.fmcsaNeverRun')
                    : t('settings.ops.fmcsaLastRun', { date: revalidation.lastVerifiedAt })}
                </p>
              ) : (
                <p className="rounded border-l-4 border-warning-300 bg-warning-50 px-3 py-2 text-xs text-carbon">
                  {t('settings.ops.fmcsaNotConnected', { count: String(revalidation.dueCount) })}
                </p>
              )}
            </div>
          </Wide>

          <Wide>
            <div className="flex flex-col gap-3 border-t border-steel-100 pt-4">
              <Checkbox
                label={t('settings.ops.dispatcherAssign')}
                hint={t('settings.ops.dispatcherAssignHint')}
                checked={form.data.allow_dispatcher_resource_assignment}
                onChange={(v) => form.setData('allow_dispatcher_resource_assignment', v)}
                disabled={bloqueado}
              />
              {/*
                El texto de ayuda dice QUÉ HACE, y no es adorno: este interruptor
                estuvo inerte desde el primer día. Se encendía, la persona creía
                tener un segundo par de ojos sobre las cargas sobredimensionadas,
                y el despacho se comportaba igual.
              */}
              <Checkbox
                label={t('settings.ops.oversizeAdmin')}
                hint={t('settings.ops.oversizeAdminHint')}
                checked={form.data.require_oversize_admin_validation}
                onChange={(v) => form.setData('require_oversize_admin_validation', v)}
                disabled={bloqueado}
              />
              <Checkbox
                label={t('settings.ops.publicTracking')}
                checked={form.data.public_tracking_enabled}
                onChange={(v) => form.setData('public_tracking_enabled', v)}
                disabled={bloqueado}
              />
            </div>
          </Wide>

          {/* La retención se enseña y no se edita: cambiarla tiene
              consecuencias legales y no debería ser un campo más de un
              formulario. */}
          <Wide>
            <Note>
              {t('settings.retention.note', {
                months: String(readOnly.operationalActiveMonths),
                purge: String(readOnly.operationalPurgeYears),
                financial: String(readOnly.financialRetentionYears),
              })}
            </Note>
          </Wide>
        </FieldGrid>

        <Guardar procesando={form.processing} bloqueado={bloqueado} nota={t('settings.ops.saveNote')} />
      </Card>
    </form>
  )
}

/* ── Contacto público ───────────────────────────────────────────────────── */

function SeccionContacto({ settings, bloqueado }: { settings: Settings; bloqueado: boolean }) {
  const { t } = useI18n()

  const form = useForm({
    section: 'contact',
    contact_phone: settings.contact_phone ?? '',
    contact_email: settings.contact_email ?? '',
    support_email: settings.support_email ?? '',
    address_line1: settings.address_line1 ?? '',
    address_line2: settings.address_line2 ?? '',
    address_city: settings.address_city ?? '',
    address_country: settings.address_country,
    address_state: settings.address_state ?? '',
    address_postal_code: settings.address_postal_code ?? '',
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.patch('/settings', { preserveScroll: true }) }}>
      <Card>
        <CardHeader title={t('settings.contact.title')} note={t('settings.contact.note')} />

        <FieldGrid>
          <TextInput
            type="tel"
            maxLength={32}
            label={t('settings.contact.phone')}
            error={form.errors.contact_phone}
            disabled={bloqueado}
            value={form.data.contact_phone}
            onChange={(e) => form.setData('contact_phone', e.target.value)}
          />
          <TextInput
            type="email"
            maxLength={255}
            label={t('settings.contact.email')}
            error={form.errors.contact_email}
            disabled={bloqueado}
            value={form.data.contact_email}
            onChange={(e) => form.setData('contact_email', e.target.value)}
          />
          <TextInput
            type="email"
            maxLength={255}
            label={t('settings.contact.support')}
            error={form.errors.support_email}
            disabled={bloqueado}
            value={form.data.support_email}
            onChange={(e) => form.setData('support_email', e.target.value)}
          />
          <TextInput
            maxLength={12}
            label={t('settings.contact.postal')}
            error={form.errors.address_postal_code}
            disabled={bloqueado}
            value={form.data.address_postal_code}
            onChange={(e) => form.setData('address_postal_code', e.target.value)}
          />
          <TextInput
            maxLength={200}
            label={t('settings.contact.line1')}
            error={form.errors.address_line1}
            disabled={bloqueado}
            value={form.data.address_line1}
            onChange={(e) => form.setData('address_line1', e.target.value)}
          />
          <TextInput
            maxLength={200}
            label={t('settings.contact.line2')}
            error={form.errors.address_line2}
            disabled={bloqueado}
            value={form.data.address_line2}
            onChange={(e) => form.setData('address_line2', e.target.value)}
          />
          <TextInput
            maxLength={120}
            label={t('settings.contact.city')}
            error={form.errors.address_city}
            disabled={bloqueado}
            value={form.data.address_city}
            onChange={(e) => form.setData('address_city', e.target.value)}
          />

          <CountryStateFields
            country={form.data.address_country}
            state={form.data.address_state}
            onChange={(next) => {
              form.setData((d) => ({ ...d, address_country: next.country, address_state: next.state }))
            }}
            countryError={form.errors.address_country}
            stateError={form.errors.address_state}
            disabled={bloqueado}
          />
        </FieldGrid>

        <Guardar procesando={form.processing} bloqueado={bloqueado} nota={t('settings.contact.saveNote')} />
      </Card>
    </form>
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

/**
 * La cara de la empresa.
 *
 * Lo que se edita aquí NO cambia nada dentro de la aplicación: cambia lo que ve
 * el cliente al que le mandan un enlace de rastreo — la página que abre y el pie
 * del correo que la lleva. La nota de la sección lo dice, porque «marca» en un
 * panel de ajustes suena a que va a cambiarlo todo.
 */
function Marca({
  branding, templates, bloqueado,
}: {
  branding: Props['branding']
  templates: Props['templates']
  bloqueado: boolean
}) {
  const { t } = useI18n()
  const form = useForm<{
    primary_color: string
    accent_color: string
    email_footer: string
    templates: { event: string; subject: string; body: string }[]
    logo: File | null
  }>({
    primary_color: branding.primaryColor,
    accent_color: branding.accentColor,
    email_footer: branding.emailFooter ?? '',
    templates: templates.map((p) => ({
      event: p.event,
      subject: p.subject ?? '',
      body: p.body ?? '',
    })),
    logo: null,
  })

  const cambiar = (i: number, campo: 'subject' | 'body', valor: string) => {
    form.setData(
      'templates',
      form.data.templates.map((p, j) => (i === j ? { ...p, [campo]: valor } : p)),
    )
  }

  /**
   * El servidor rechaza una plantilla con `templates.0.body`, que no es una
   * clave del formulario sino una ruta con puntos. `form.errors.body` no
   * existe, así que sin esto el 422 llega, la pantalla no guarda nada y el
   * usuario no ve ni una línea: el mismo texto de siempre en los campos y
   * ninguna explicación. Aquí es donde el mensaje encuentra su hueco.
   */
  const errorDe = (i: number, campo: 'subject' | 'body'): string | undefined =>
    (form.errors as unknown as Record<string, string | undefined>)[`templates.${i}.${campo}`]

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.post('/settings/branding', { preserveScroll: true, forceFormData: true })
      }}
      className="mt-6 flex max-w-3xl flex-col gap-6"
    >
      <Seccion titulo={t('settings.brand.title')} nota={t('settings.brand.note')}>
        <div className="sm:col-span-2">
          <p className="text-xs font-medium uppercase tracking-wide text-steel-600">
            {t('settings.brand.preview')}
          </p>
          <div className="mt-1 overflow-hidden rounded border border-steel-200 bg-white">
            <div className="h-2 w-full" style={{ backgroundColor: form.data.primary_color }} />
            <div className="flex items-center gap-3 p-3">
              {branding.logoUrl ? (
                <img src={branding.logoUrl} alt={branding.name} className="h-8 w-auto" />
              ) : (
                <span className="text-sm font-semibold text-carbon">{branding.name}</span>
              )}
              <span className="text-xs" style={{ color: form.data.accent_color }}>
                {branding.name}
              </span>
            </div>
          </div>
        </div>

        <Campo label={t('settings.brand.logo')} hint={t('settings.brand.logoHint')} error={form.errors.logo}>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            disabled={bloqueado}
            onChange={(e) => form.setData('logo', e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </Campo>

        <Campo label={t('settings.brand.primaryColor')} hint={t('settings.brand.colorHint')} error={form.errors.primary_color}>
          <input
            type="color"
            disabled={bloqueado}
            value={form.data.primary_color}
            onChange={(e) => form.setData('primary_color', e.target.value.toUpperCase())}
            className="h-10 w-20 rounded border border-steel-300"
          />
        </Campo>

        <Campo label={t('settings.brand.accentColor')} hint={t('settings.brand.colorHint')} error={form.errors.accent_color}>
          <input
            type="color"
            disabled={bloqueado}
            value={form.data.accent_color}
            onChange={(e) => form.setData('accent_color', e.target.value.toUpperCase())}
            className="h-10 w-20 rounded border border-steel-300"
          />
        </Campo>

        <Campo
          label={t('settings.brand.emailFooter')}
          hint={t('settings.brand.emailFooterHint')}
          error={form.errors.email_footer}
        >
          <textarea
            rows={3}
            maxLength={500}
            disabled={bloqueado}
            value={form.data.email_footer}
            onChange={(e) => form.setData('email_footer', e.target.value)}
            className={CAMPO}
          />
        </Campo>
      </Seccion>

      {templates.map((plantilla, i) => (
        <Seccion
          key={plantilla.event}
          titulo={t(`settings.brand.templates.${claveDeEvento(plantilla.event)}`)}
          nota={t('settings.brand.templateNote', {
            tokens: plantilla.tokens.map((k) => `{${k}}`).join(', '),
          })}
        >
          <Campo label={t('settings.brand.templateSubject')} error={errorDe(i, 'subject')}>
            <input
              type="text"
              maxLength={255}
              disabled={bloqueado}
              value={form.data.templates[i]?.subject ?? ''}
              onChange={(e) => cambiar(i, 'subject', e.target.value)}
              className={CAMPO}
            />
          </Campo>
          <Campo label={t('settings.brand.templateBody')} error={errorDe(i, 'body')}>
            <textarea
              rows={6}
              maxLength={4000}
              disabled={bloqueado}
              value={form.data.templates[i]?.body ?? ''}
              onChange={(e) => cambiar(i, 'body', e.target.value)}
              className={CAMPO}
            />
          </Campo>
        </Seccion>
      ))}

      {! bloqueado ? (
        <div>
          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {t('settings.brand.save')}
          </button>
        </div>
      ) : null}
    </form>
  )
}

/**
 * El webhook del alta de transportista.
 *
 * ## Lo que esta sección tiene que decir, y por qué no basta con los campos
 *
 * Una URL, un secreto y una casilla «Activado» dejan a quien los rellena
 * creyendo que a partir de ahí cada alta llega a su CRM. Si el planificador no
 * corre, no llega ninguna — y sin el aviso de abajo la pantalla diría
 * exactamente lo mismo en los dos casos.
 *
 * Por eso van por separado, y no en un semáforo: el estado de la configuración,
 * el del barrido, la cola pendiente y la última entrega REAL. Un verde único
 * que los junte es una garantía inventada.
 *
 * ## El secreto
 *
 * No llega a esta pantalla. Nunca. Lo único que viaja son los cuatro últimos
 * caracteres, para poder decir CUÁL hay puesto. Si se genera uno nuevo, se
 * enseña una vez —aquí, en un aviso que no vuelve— y después ya no existe en
 * ningún sitio legible.
 */
function Webhook({
  estado,
  secretoUnaVez,
  bloqueado,
}: {
  estado: Props['webhook']
  secretoUnaVez: string | null
  bloqueado: boolean
}) {
  const { t } = useI18n()
  const form = useForm({
    carrier_signup_webhook_url: estado.url ?? '',
    carrier_signup_webhook_enabled: estado.enabled,
    carrier_signup_webhook_secret: '',
    generate_secret: false as boolean,
  })
  const prueba = useForm({})

  const texto = (clave: string, params?: Record<string, string>) => t(`settings.webhook.${clave}`, params)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.post('/settings/webhook', { preserveScroll: true })
      }}
      className="mt-6 flex max-w-3xl flex-col gap-6"
    >
      <Seccion titulo={texto('title')} nota={texto('note')}>
        {secretoUnaVez === null ? null : (
          <div className="sm:col-span-2 rounded border border-warning-300 bg-warning-50 px-3 py-2">
            <p className="text-xs font-semibold text-carbon">{texto('secretOnce')}</p>
            <code className="mt-1 block break-all font-mono text-xs text-carbon">{secretoUnaVez}</code>
          </div>
        )}

        <div className="sm:col-span-2">
          <Campo
            label={texto('url')}
            hint={texto('urlHint')}
            error={form.errors.carrier_signup_webhook_url}
          >
            <input
              type="url"
              className={CAMPO}
              disabled={bloqueado}
              placeholder="https://"
              value={form.data.carrier_signup_webhook_url}
              onChange={(e) => form.setData('carrier_signup_webhook_url', e.target.value)}
            />
          </Campo>
        </div>

        <div className="sm:col-span-2">
          <Campo
            label={texto('secret')}
            hint={
              estado.secretLast4 === null
                ? texto('secretNone')
                : texto('secretSet', { last4: estado.secretLast4 })
            }
            error={form.errors.carrier_signup_webhook_secret}
          >
            <div className="flex gap-2">
              <input
                type="password"
                autoComplete="new-password"
                className={CAMPO}
                disabled={bloqueado}
                placeholder={texto('secretKeep')}
                value={form.data.carrier_signup_webhook_secret}
                onChange={(e) => form.setData('carrier_signup_webhook_secret', e.target.value)}
              />
              <button
                type="button"
                disabled={bloqueado || form.processing}
                onClick={() => {
                  form.setData('generate_secret', true)
                  form.transform((d) => ({ ...d, generate_secret: true }))
                  form.post('/settings/webhook', {
                    preserveScroll: true,
                    onFinish: () => form.transform((d) => ({ ...d, generate_secret: false })),
                  })
                }}
                className="whitespace-nowrap rounded border border-steel-300 px-3 py-2 text-sm font-medium text-carbon transition hover:bg-steel-50 disabled:opacity-50"
              >
                {texto('generate')}
              </button>
            </div>
          </Campo>
        </div>

        <div className="sm:col-span-2">
          <Casilla
            label={texto('enabled')}
            hint={texto('enabledHint')}
            checked={form.data.carrier_signup_webhook_enabled}
            onChange={(v) => form.setData('carrier_signup_webhook_enabled', v)}
            disabled={bloqueado}
          />
          {form.errors.carrier_signup_webhook_enabled ? (
            <p className="mt-1 text-xs text-danger-700">{form.errors.carrier_signup_webhook_enabled}</p>
          ) : null}
        </div>

        {/* ── Si esto está entregando de verdad ──────────────────────────── */}
        <div className="sm:col-span-2 flex flex-col gap-2">
          {estado.enabled && estado.sweepStalled ? (
            <p className="rounded border-l-4 border-warning-300 bg-warning-50 px-2 py-1.5 text-xs text-carbon">
              {estado.sweepLastRunAt === null
                ? texto('sweepNeverRan')
                : texto('sweepStalled', { date: estado.sweepLastRunAt })}
            </p>
          ) : null}

          {estado.enabled && ! estado.sweepStalled && estado.sweepLastRunAt !== null ? (
            <p className="text-xs text-steel-600">{texto('sweepOk', { date: estado.sweepLastRunAt })}</p>
          ) : null}

          {estado.abandoned > 0 ? (
            <p className="rounded border-l-4 border-danger-300 bg-danger-50 px-2 py-1.5 text-xs text-carbon">
              {texto('abandoned', { count: String(estado.abandoned) })}
            </p>
          ) : null}

          {estado.pending > 0 ? (
            <p className="text-xs text-steel-600">{texto('pending', { count: String(estado.pending) })}</p>
          ) : null}

          <p className="text-xs text-steel-600">
            {estado.last === null
              ? texto('noRealDelivery')
              : texto('lastDelivery', {
                  status: t(`settings.webhook.status.${estado.last.status}`),
                  date: estado.last.createdAt.slice(0, 16),
                })}
          </p>
        </div>

        {/* ── El registro de entregas ────────────────────────────────────── */}
        {estado.recent.length > 0 ? (
          <div className="sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-steel-600">{texto('log')}</p>
            <ul className="mt-1 divide-y divide-steel-200 rounded border border-steel-200">
              {estado.recent.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                  <span className="font-medium text-carbon">{d.createdAt.slice(0, 16)}</span>
                  <span className="text-steel-700">{d.event}</span>
                  {d.isTest ? (
                    <span className="rounded bg-steel-100 px-1.5 py-0.5 text-steel-700">{texto('test')}</span>
                  ) : null}
                  <span
                    className={
                      d.status === 'delivered'
                        ? 'text-success-700'
                        : d.status === 'abandoned'
                          ? 'text-danger-700'
                          : 'text-steel-700'
                    }
                  >
                    {t(`settings.webhook.status.${d.status}`)}
                  </span>
                  {d.responseStatus === null ? null : <span className="text-steel-600">HTTP {d.responseStatus}</span>}
                  <span className="text-steel-600">{texto('attempts', { count: String(d.attempts) })}</span>
                  {d.error === null ? null : <span className="text-danger-700">{d.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {bloqueado ? null : (
          <div className="sm:col-span-2 flex gap-2">
            <button
              type="submit"
              disabled={form.processing}
              className="rounded bg-safety-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:opacity-50"
            >
              {form.processing ? t('common.states.saving') : t('settings.index.save')}
            </button>
            <button
              type="button"
              disabled={prueba.processing || estado.url === null || estado.secretLast4 === null}
              onClick={() => prueba.post('/settings/webhook/test', { preserveScroll: true })}
              className="rounded border border-steel-300 px-5 py-2.5 text-sm font-semibold text-carbon transition hover:bg-steel-50 disabled:opacity-50"
            >
              {prueba.processing ? t('common.states.saving') : texto('sendTest')}
            </button>
          </div>
        )}
      </Seccion>
    </form>
  )
}
