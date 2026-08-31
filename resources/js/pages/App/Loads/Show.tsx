import { Link, router, useForm } from '@inertiajs/react'
import { AssignPanel, type Assignable } from '@/components/App/AssignPanel'
import { useState, type ReactNode } from 'react'
import { StatusBadge } from '@/components/App/StatusBadge'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import { formatCents } from '@/lib/format'

interface Stop {
  id: string
  type: string
  sequence: number
  name: string | null
  line1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  timezone: string
  appointmentType: string
  windowStart: string | null
  windowEnd: string | null
  actualArrivalAt: string | null
  actualDepartureAt: string | null
  detentionMinutes: number | null
  instructions: string | null
  contactName: string | null
  contactPhone: string | null
}

interface Assignment {
  id: string
  type: string
  isPrimary: boolean
  label: string
  phone: string | null
  licenseExpiresAt: string | null
  medicalCardExpiresAt: string | null
}

interface Financials {
  customerCharge: number
  carrierGrossRate: number
  dispatchFeeBps: number
  commissionBps: number
  commissionBasis: string
  feeBase: string
  excludedExpenses: number
  reimbursableExpenses: number
  tenantAbsorbedExpenses: number
  carrierDeductions: number
  commissionableBase: number
  dispatchFee: number
  netCarrierSettlement: number
  grossMargin: number
  dispatcherCommission: number
  netMargin: number
}

interface Action {
  action: string
  /**
   * Mensajes YA TRADUCIDOS por el servidor, no claves.
   *
   * El nombre lo dice a propósito. Se llamaba `blocking`, igual que el campo de
   * otras pantallas que sí trae claves, y aquí se volvía a traducir: la ficha de
   * carga —la pantalla más usada— enseñaba «loads.blocking.No se ha elegido
   * transportista.» a cualquiera que intentara despachar sin transportista.
   *
   * El servidor los redacta porque los documentos que faltan llevan el tipo
   * pegado a la clave (`missingDocument:certificate_of_insurance`) y partirla en
   * dos sitios acaba discrepando.
   */
  blockingMessages: string[]
  requiresReason: boolean
}

interface Props {
  load: {
    id: string
    loadNumber: string
    status: string
    customerReference: string | null
    poNumber: string | null
    customer: { id: string; name: string } | null
    carrier: { id: string; name: string; dotNumber: string; onboardingStatus: string } | null
    commodity: string | null
    weightPounds: number | null
    pieceCount: number | null
    dimensions: { length: number | null; width: number | null; height: number | null }
    isOversize: boolean
    isOverweight: boolean
    permitApprovedAt: string | null
    miles: number | null
    deadheadMiles: number | null
    plannedPickupAt: string | null
    plannedDeliveryAt: string | null
    actualPickupAt: string | null
    actualDeliveryAt: string | null
    podReceivedAt: string | null
    specialInstructions: string | null
    internalNotes: string | null
    cancellationReason: string | null
  }
  stops: Stop[]
  assignments: Assignment[]
  history: {
    from: string | null
    to: string
    reason: string | null
    source: string
    at: string
    by: string | null
  }[]
  financials: Financials | null
  actions: Action[]
  assignable: Assignable | null
  carrierLocked: boolean
  can: Record<string, boolean>
}

export default function LoadShow({
  load, stops, assignments, history, financials, actions, assignable, carrierLocked, can,
}: Props) {
  const { t, locale } = useI18n()

  const dt = (value: string | null, withTime = true): string =>
    value
      ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
          dateStyle: 'medium',
          ...(withTime ? { timeStyle: 'short' } : {}),
        }).format(new Date(value))
      : '—'

  const statusLabel = (s: string) =>
    t(`nav.status.load.${s.replace(/_(.)/g, (_, c: string) => c.toUpperCase())}`)

  return (
    <AppLayout
      title={load.loadNumber}
      crumbs={[{ label: t('loads.index.title'), href: '/loads' }, { label: load.loadNumber }]}
      actions={
        <>
          {/*
            Los papeles y la confirmación de tarifa son PANTALLAS de la carga, y
            hasta ahora no se llegaba a ninguna de las dos más que escribiendo
            la URL a mano. Una pantalla sin enlace es una pantalla que no
            existe: la de papeles se acaba de escribir, y la de tarifa llevaba
            desde el lote 46 construida y sin puerta de entrada.
          */}
          <Link
            href={`/loads/${load.id}/documents`}
            className="rounded border border-steel-300 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('loads.documents.link')}
          </Link>
          {/*
            Un botón y no un enlace: la primera vez CREA el hilo y mete dentro
            al transportista. Un GET que escribe es un GET que el prefetch del
            navegador dispara solo.
          */}
          <button
            type="button"
            onClick={() => router.post(`/loads/${load.id}/messages`)}
            className="rounded border border-steel-300 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('messages.index.title')}
          </button>
          <Link
            href={`/loads/${load.id}/rate-confirmation`}
            className="rounded border border-steel-300 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('loads.rateConfirmation.title')}
          </Link>
          {can.update ? (
            <Link
              href={`/loads/${load.id}/edit`}
              className="rounded border border-steel-300 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
            >
              {t('common.actions.edit')}
            </Link>
          ) : null}
          <ActionBar actions={actions} loadId={load.id} />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge family="load" value={load.status} />
        {load.isOversize ? (
          <span className="inline-flex rounded bg-safety-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-safety-800">
            {t('loads.detail.oversize')}
          </span>
        ) : null}
        {load.isOverweight ? (
          <span className="inline-flex rounded bg-safety-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-safety-800">
            {t('loads.detail.overweight')}
          </span>
        ) : null}
        {load.customer ? (
          <Link
            href={`/customers/${load.customer.id}`}
            className="text-sm text-navy-700 underline-offset-2 hover:underline"
          >
            {load.customer.name}
          </Link>
        ) : null}
      </div>

      {load.cancellationReason ? (
        <p className="mt-4 rounded border-l-4 border-danger-500 bg-danger-50 p-3 text-sm">
          <strong className="block">{t('loads.detail.cancelledBecause')}</strong>
          {load.cancellationReason}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title={t('loads.detail.freight')}>
            <Dl>
              <Item label={t('loads.detail.commodity')}>{load.commodity ?? '—'}</Item>
              <Item label={t('loads.detail.weight')}>
                {load.weightPounds === null
                  ? '—'
                  : t('loads.detail.pounds', { value: load.weightPounds.toLocaleString() })}
              </Item>
              <Item label={t('loads.detail.dimensions')}>
                {load.dimensions.length === null
                  ? '—'
                  : `${load.dimensions.length} × ${load.dimensions.width ?? '?'} × ${load.dimensions.height ?? '?'}`}
              </Item>
              <Item label={t('loads.detail.pieces')}>{load.pieceCount ?? '—'}</Item>
              <Item label={t('loads.detail.miles')}>
                {load.miles === null ? '—' : load.miles.toLocaleString()}
              </Item>
              <Item label={t('loads.detail.deadhead')}>
                {load.deadheadMiles === null ? '—' : load.deadheadMiles.toLocaleString()}
              </Item>
              <Item label={t('loads.detail.reference')}>{load.customerReference ?? '—'}</Item>
              <Item label={t('loads.detail.poNumber')}>{load.poNumber ?? '—'}</Item>
            </Dl>

            {load.isOversize ? (
              <p
                className={`mt-4 rounded border-l-4 p-3 text-sm ${
                  load.permitApprovedAt
                    ? 'border-success-500 bg-success-50'
                    : 'border-safety-500 bg-safety-50'
                }`}
              >
                {load.permitApprovedAt
                  ? `${t('loads.detail.permitApproved')} — ${dt(load.permitApprovedAt, false)}`
                  : t('loads.detail.permitNotApproved')}
              </p>
            ) : null}
          </Card>

          <Card title={t('loads.detail.stops')}>
            {stops.length === 0 ? (
              <p className="text-sm text-steel-700">{t('loads.detail.noStops')}</p>
            ) : (
              <ol className="flex flex-col gap-4">
                {stops.map((s) => (
                  <li key={s.id} className="relative border-l-2 border-steel-200 pl-5">
                    <span
                      aria-hidden="true"
                      className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ${
                        s.type === 'pickup' ? 'bg-navy-600' : 'bg-safety-600'
                      }`}
                    />
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-steel-600">
                        {t(`loads.detail.${s.type}`)} {s.sequence}
                      </span>
                      <span className="font-medium text-carbon">{s.name ?? '—'}</span>
                    </div>
                    <p className="text-sm text-steel-700">
                      {[s.line1, s.city, s.state, s.postalCode].filter(Boolean).join(', ')}
                    </p>
                    <p className="text-xs text-steel-600">
                      {t(`loads.appointmentType.${s.appointmentType}`)}
                      {s.windowStart ? ` · ${dt(s.windowStart)}` : ''}
                      {s.windowEnd ? ` – ${dt(s.windowEnd)}` : ''}
                    </p>
                    {s.actualArrivalAt ? (
                      <p className="text-xs text-success-700">
                        {t('loads.detail.arrived')}: {dt(s.actualArrivalAt)}
                        {s.actualDepartureAt ? ` · ${t('loads.detail.departed')}: ${dt(s.actualDepartureAt)}` : ''}
                      </p>
                    ) : null}
                    {s.detentionMinutes ? (
                      <p className="text-xs font-medium text-safety-700">
                        {t('loads.detail.detention', { minutes: s.detentionMinutes })}
                      </p>
                    ) : null}
                    {s.instructions ? (
                      <p className="mt-1 text-xs text-steel-700">{s.instructions}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title={t('loads.detail.equipment')}>
            {assignments.length === 0 ? (
              <p className="text-sm text-steel-700">{t('loads.detail.noAssignments')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-steel-100">
                {assignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <span className="w-20 shrink-0 text-xs font-bold uppercase tracking-wide text-safety-600">
                      {a.type}
                    </span>
                    <span className="font-medium text-carbon">{a.label}</span>
                    {a.phone ? <span className="text-xs text-steel-600">{a.phone}</span> : null}
                    {a.licenseExpiresAt ? (
                      <span className="ml-auto text-xs text-steel-600">
                        {t('loads.detail.licenseExpires')}: {dt(a.licenseExpiresAt, false)}
                      </span>
                    ) : null}
                    {can.assignResources ? (
                      <button
                        type="button"
                        onClick={() =>
                          router.delete(`/loads/${load.id}/resources/${a.id}`, { preserveScroll: true })
                        }
                        className="ml-auto rounded border border-steel-300 px-2 py-1 text-xs text-steel-700 transition hover:bg-danger-50 hover:text-danger-700"
                      >
                        {t('loads.assign.remove')}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('loads.detail.history')}>
            {history.length === 0 ? (
              <p className="text-sm text-steel-700">{t('loads.detail.noHistory')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-steel-100">
                {history.map((h, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <StatusBadge family="load" value={h.to} />
                    <span className="text-xs text-steel-600">
                      {h.from ? `${statusLabel(h.from)} → ` : ''}
                      {dt(h.at)}
                      {h.by ? ` · ${h.by}` : ''}
                      {/* Quién lo movió: una persona, el GPS o un trabajo
                          automático. Solo se dice cuando NO fue una persona —
                          «user» en cada fila sería ruido. */}
                      {h.source !== 'user' ? ` · ${h.source}` : ''}
                    </span>
                    {h.reason ? (
                      <span className="w-full text-xs text-steel-700">{h.reason}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('loads.detail.notes')}>
            <p className="whitespace-pre-wrap text-sm text-carbon">
              {load.specialInstructions ?? load.internalNotes ?? t('loads.detail.noNotes')}
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {load.carrier ? (
            <Card title={t('loads.detail.carrier')}>
              <Link
                href={`/carriers/${load.carrier.id}`}
                className="font-medium text-navy-700 underline-offset-2 hover:underline"
              >
                {load.carrier.name}
              </Link>
              <p className="text-xs text-steel-600">USDOT {load.carrier.dotNumber}</p>
              <div className="mt-2">
                <StatusBadge family="onboarding" value={load.carrier.onboardingStatus} />
              </div>
            </Card>
          ) : null}

          {assignable ? (
            <AssignPanel
              loadId={load.id}
              carrierId={load.carrier?.id ?? null}
              carrierRateCents={financials?.carrierGrossRate ?? null}
              assignable={assignable}
              can={{
                // Una vez despachada, el transportista queda cerrado: cambiarlo
                // a estas alturas no es una corrección, es otra carga.
                assignCarrier: Boolean(can.assignCarrier) && !carrierLocked,
                assignResources: Boolean(can.assignResources),
              }}
            />
          ) : null}

          {/* El bloque de dinero solo existe si el servidor lo mandó. Un
              conductor tiene load:read pero no load:financials:read, y su
              respuesta no lleva estos números en absoluto. */}
          {financials ? <MoneyCard f={financials} /> : null}

          <Card title={t('loads.detail.plannedPickup')}>
            <Dl compact>
              <Item label={t('loads.detail.plannedPickup')}>{dt(load.plannedPickupAt)}</Item>
              <Item label={t('loads.detail.actualPickup')}>{dt(load.actualPickupAt)}</Item>
              <Item label={t('loads.detail.plannedDelivery')}>{dt(load.plannedDeliveryAt)}</Item>
              <Item label={t('loads.detail.actualDelivery')}>{dt(load.actualDeliveryAt)}</Item>
              <Item label={t('loads.detail.podReceived')}>{dt(load.podReceivedAt)}</Item>
            </Dl>
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}

/**
 * El desglose del dinero, en el mismo orden en que se calcula.
 *
 * Enseñar los intermedios y no solo los totales es deliberado: quien discute una
 * liquidación pregunta «¿de dónde sale este número?», y una tarjeta que solo
 * enseñara el total obligaría a rehacer la cuenta a mano para responderle.
 */
function MoneyCard({ f }: { f: Financials }) {
  const { t, locale } = useI18n()
  const m = (c: number) => formatCents(c, locale)

  if (f.carrierGrossRate === 0) {
    return (
      <Card title={t('loads.detail.money')}>
        <Row label={t('loads.money.customerCharge')} value={m(f.customerCharge)} />
        <p className="mt-3 text-sm text-steel-700">{t('loads.money.noRateYet')}</p>
      </Card>
    )
  }

  return (
    <Card title={t('loads.detail.money')}>
      <Row label={t('loads.money.customerCharge')} value={m(f.customerCharge)} />
      <Row label={t('loads.money.carrierGrossRate')} value={m(f.carrierGrossRate)} />

      {f.excludedExpenses > 0 ? (
        <>
          <Row label={t('loads.money.excluded')} value={`− ${m(f.excludedExpenses)}`} muted />
          <Row label={t('loads.money.commissionableBase')} value={m(f.commissionableBase)} rule />
        </>
      ) : null}

      <Row
        label={`${t('loads.money.dispatchFee')} (${(f.dispatchFeeBps / 100).toFixed(2).replace(/\.?0+$/, '')}%)`}
        value={m(f.dispatchFee)}
        strong
      />

      {f.reimbursableExpenses > 0 ? (
        <Row label={t('loads.money.reimbursable')} value={`+ ${m(f.reimbursableExpenses)}`} muted />
      ) : null}
      {f.carrierDeductions > 0 ? (
        <Row label={t('loads.money.deductions')} value={`− ${m(f.carrierDeductions)}`} muted />
      ) : null}

      <Row label={t('loads.money.netCarrierSettlement')} value={m(f.netCarrierSettlement)} rule />

      {f.tenantAbsorbedExpenses > 0 ? (
        <Row label={t('loads.money.absorbed')} value={`− ${m(f.tenantAbsorbedExpenses)}`} muted />
      ) : null}

      <Row label={t('loads.money.grossMargin')} value={m(f.grossMargin)} rule />
      <Row
        label={`${t('loads.money.dispatcherCommission')} · ${t('loads.money.commissionOn', {
          basis: t(`loads.money.basis.${f.commissionBasis}`),
        })}`}
        value={`− ${m(f.dispatcherCommission)}`}
        muted
      />
      <Row label={t('loads.money.netMargin')} value={m(f.netMargin)} strong rule />

      <p className="mt-3 border-t border-steel-100 pt-3 text-xs text-steel-600">
        {t(f.feeBase === 'commissionable_base' ? 'loads.money.feeBaseNote' : 'loads.money.feeBaseNoteGross')}
      </p>
    </Card>
  )
}

function Row({
  label, value, muted, strong, rule,
}: { label: string; value: string; muted?: boolean; strong?: boolean; rule?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-1 text-sm ${
        rule ? 'mt-1 border-t border-steel-200 pt-2' : ''
      }`}
    >
      <span className={muted ? 'text-xs text-steel-600' : 'text-steel-700'}>{label}</span>
      <span
        className={`shrink-0 tabular-nums ${
          strong ? 'font-bold text-navy-700' : muted ? 'text-xs text-steel-600' : 'text-carbon'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Los botones de cambio de estado.
 *
 * Una acción bloqueada se enseña DESACTIVADA y con el motivo escrito, no
 * escondida. Ocultarla dejaría a alguien preguntándose por qué no puede
 * despachar; enseñarla con «falta asignar conductor» le dice qué hacer.
 */
function ActionBar({ actions, loadId }: { actions: Action[]; loadId: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState<string | null>(null)
  const form = useForm({ reason: '' })

  if (actions.length === 0) {
    return null
  }

  const run = (a: Action) => {
    if (a.requiresReason) {
      setOpen(a.action)
      return
    }

    router.post(`/loads/${loadId}/status/${a.action}`, {}, { preserveScroll: true })
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a) => {
          const blocked = a.blockingMessages.length > 0
          const primary = !blocked && a.action !== 'cancelled'

          return (
            <span key={a.action} className="group relative">
              <button
                type="button"
                disabled={blocked}
                onClick={() => run(a)}
                title={blocked ? a.blockingMessages.join(' ') : undefined}
                className={`rounded px-4 py-2 text-sm font-medium transition ${
                  blocked
                    ? 'cursor-not-allowed border border-steel-300 bg-steel-100 text-steel-500'
                    : primary
                      ? 'bg-safety-600 text-white hover:bg-safety-700'
                      : 'border border-danger-500 text-danger-700 hover:bg-danger-50'
                }`}
              >
                {t(`loads.actions.${a.action}`)}
              </button>
            </span>
          )
        })}
      </div>

      {/* Los motivos de bloqueo, escritos. El `title` del botón no sirve para
          quien navega con teclado ni en un móvil. */}
      {actions.some((a) => a.blockingMessages.length > 0) ? (
        <div className="mt-3 w-full rounded border-l-4 border-safety-500 bg-safety-50 p-3 text-sm">
          <strong className="block text-xs uppercase tracking-wide">
            {t('loads.transition.blockedTitle')}
          </strong>
          <ul className="mt-1 list-disc pl-4">
            {[...new Set(actions.flatMap((a) => a.blockingMessages))].map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {open !== null ? (
        <div className="mt-3 w-full rounded border border-danger-300 bg-danger-50 p-4">
          <label className="block text-sm font-medium text-carbon" htmlFor="cancel-reason">
            {t('loads.transition.reasonLabel')}
          </label>
          <textarea
            id="cancel-reason"
            rows={3}
            value={form.data.reason}
            onChange={(e) => form.setData('reason', e.target.value)}
            className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
          {form.errors.reason ? (
            <p role="alert" className="mt-1 text-sm text-danger-700">
              {form.errors.reason}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() =>
                form.post(`/loads/${loadId}/status/${open}`, {
                  preserveScroll: true,
                  onSuccess: () => setOpen(null),
                })
              }
              className="rounded bg-danger-500 px-4 py-2 text-sm font-semibold text-white"
            >
              {t('loads.transition.confirm')}
            </button>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded border border-steel-300 bg-white px-4 py-2 text-sm"
            >
              {t('loads.transition.cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-steel-200 bg-white p-5">
      <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-safety-600">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Dl({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return <dl className={`grid gap-x-6 gap-y-3 ${compact ? '' : 'sm:grid-cols-2'}`}>{children}</dl>
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-steel-600">{label}</dt>
      <dd className="truncate text-sm text-carbon">{children}</dd>
    </div>
  )
}
