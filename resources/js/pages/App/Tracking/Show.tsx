import { Link, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Stop {
  id: string
  type: string
  sequence: number
  facility: string | null
  city: string | null
  state: string | null
  windowStart: string | null
  windowEnd: string | null
  arrivedAt: string | null
  departedAt: string | null
}

interface CheckCall {
  id: string
  scheduledFor: string
  completedAt: string | null
  completedBy: string | null
  origin: string
  notes: string | null
  locationSummary: string | null
  overdue: boolean
}

interface TrackingLink {
  id: string
  label: string | null
  recipientEmail: string | null
  expiresAt: string
  revokedAt: string | null
  viewCount: number
  lastViewedAt: string | null
  createdAt: string
  state: 'active' | 'expired' | 'revoked'
}

interface Props {
  load: { id: string; number: string; status: string }
  stops: Stop[]
  checkCalls: CheckCall[]
  links: TrackingLink[]
  publicTrackingEnabled: boolean
  defaultTtlHours: number
  newLinkUrl: string | null
  session: {
    running: boolean
    startedAt: string | null
    driver: { id: string; name: string } | null
    /**
     * Por qué no puede empezar, como clave de `tracking.errors.*`. Nula si puede.
     * Clave y no frase: ver la convención de props traducidas.
     */
    blockedBy: string | null
  }
  can: { manage: boolean; createLink: boolean; revokeLink: boolean }
}

export default function TrackingShow({
  load, stops, checkCalls, links, publicTrackingEnabled, defaultTtlHours, newLinkUrl, session, can,
}: Props) {
  const { t } = useI18n()

  // El enlace recién creado llega en el flash de ESTA respuesta y no vuelve a
  // llegar nunca. Viene como prop propia: la bolsa `flash` compartida solo
  // lleva `success` y `error`, a propósito.
  const nuevoEnlace = newLinkUrl ?? undefined

  return (
    <AppLayout
      title={t('tracking.detail.title')}
      heading={load.number}
      crumbs={[
        { label: t('tracking.board.title'), href: '/tracking' },
        { label: load.number },
      ]}
    >
      <div className="flex flex-col gap-4">
        {nuevoEnlace ? (
          <div className="rounded border border-warning-300 bg-warning-50 p-4">
            <p className="text-sm font-semibold text-carbon">{t('tracking.publicLink.rawTokenWarning')}</p>
            <p className="mt-2 break-all font-mono text-sm text-navy-800">{nuevoEnlace}</p>
          </div>
        ) : null}

        <Sesion load={load} session={session} puede={can.manage} />
        <Paradas stops={stops} />
        <LlamadasDeControl load={load} checkCalls={checkCalls} puede={can.manage} />
        <Enlaces
          load={load}
          links={links}
          habilitado={publicTrackingEnabled}
          horasPorDefecto={defaultTtlHours}
          puedeCrear={can.createLink}
          puedeRevocar={can.revokeLink}
        />
      </div>
    </AppLayout>
  )
}

function Paradas({ stops }: { stops: Stop[] }) {
  const { t } = useI18n()

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <p className="text-sm font-semibold text-carbon">{t('tracking.stops.title')}</p>

      <ol className="mt-3 flex flex-col gap-3">
        {stops.map((s) => (
          <li key={s.id} className="border-l-2 border-steel-200 pl-3">
            <p className="text-sm font-medium text-carbon">
              {t(`tracking.stops.${s.type === 'pickup' ? 'pickup' : 'delivery'}`)}
              {' · '}
              {[s.facility, s.city, s.state].filter(Boolean).join(', ')}
            </p>
            {s.windowStart ? (
              <p className="text-xs text-steel-600">
                {t('tracking.stops.window', { start: s.windowStart, end: s.windowEnd ?? '' })}
              </p>
            ) : null}
            <p className="text-xs text-steel-700">
              {s.arrivedAt
                ? t('tracking.stops.arrived', { date: s.arrivedAt })
                : t('tracking.stops.pending')}
              {s.departedAt ? ` · ${t('tracking.stops.departed', { date: s.departedAt })}` : ''}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function LlamadasDeControl({
  load, checkCalls, puede,
}: {
  load: { id: string }
  checkCalls: CheckCall[]
  puede: boolean
}) {
  const { t } = useI18n()
  const [abierto, setAbierto] = useState(false)

  const form = useForm({
    scheduled_for: '',
    origin: 'scheduled',
    notes: '',
    location_summary: '',
    completed: false,
  })

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-carbon">{t('tracking.checkCalls.title')}</p>
        {puede ? (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="text-sm text-navy-700 underline"
          >
            {t('tracking.checkCalls.schedule')}
          </button>
        ) : null}
      </div>

      {abierto ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            form.post(`/loads/${load.id}/check-calls`, {
              preserveScroll: true,
              onSuccess: () => { form.reset(); setAbierto(false) },
            })
          }}
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-steel-100 pt-3"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('tracking.checkCalls.scheduledFor')}</span>
            <input
              type="datetime-local"
              value={form.data.scheduled_for}
              onChange={(e) => form.setData('scheduled_for', e.target.value)}
              className={CAMPO}
            />
          </label>

          <label className="flex min-w-56 flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('tracking.checkCalls.locationSummary')}</span>
            <input
              type="text"
              value={form.data.location_summary}
              onChange={(e) => form.setData('location_summary', e.target.value)}
              className={CAMPO}
            />
            <span className="text-[11px] text-steel-600">{t('tracking.checkCalls.locationHint')}</span>
          </label>

          <label className="flex min-w-56 flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('tracking.checkCalls.notes')}</span>
            <input
              type="text"
              value={form.data.notes}
              onChange={(e) => form.setData('notes', e.target.value)}
              className={CAMPO}
            />
            <span className="text-[11px] text-steel-600">{t('tracking.checkCalls.notesHint')}</span>
          </label>

          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={form.data.completed}
              onChange={(e) => {
                form.setData('completed', e.target.checked)
                form.setData('origin', e.target.checked ? 'manual' : 'scheduled')
              }}
              className="h-4 w-4"
            />
            {t('tracking.checkCalls.logNow')}
          </label>

          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {t('tracking.checkCalls.schedule')}
          </button>

          {Object.values(form.errors).length > 0 ? (
            <p role="alert" className="w-full text-sm text-danger-700">{Object.values(form.errors)[0]}</p>
          ) : null}
        </form>
      ) : null}

      {checkCalls.length === 0 ? (
        <p className="mt-3 text-sm text-steel-600">{t('tracking.checkCalls.empty')}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {checkCalls.map((c) => (
            <Llamada key={c.id} load={load} call={c} puede={puede} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Llamada({
  load, call, puede,
}: {
  load: { id: string }
  call: CheckCall
  puede: boolean
}) {
  const { t } = useI18n()
  const form = useForm({ notes: '', location_summary: '' })
  const [abierto, setAbierto] = useState(false)

  return (
    <li className={`rounded border p-3 ${call.overdue ? 'border-warning-300 bg-warning-50' : 'border-steel-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-carbon">
            {call.completedAt
              ? t('tracking.checkCalls.completedBy', {
                  actor: call.completedBy ?? '—',
                  date: call.completedAt,
                })
              : call.overdue
                ? t('tracking.checkCalls.overdue', { date: call.scheduledFor })
                : t('tracking.checkCalls.due', { date: call.scheduledFor })}
            <span className="ml-2 text-xs text-steel-600">
              {t(`tracking.checkCalls.origin.${call.origin}`)}
            </span>
          </p>
          {call.locationSummary ? (
            <p className="mt-0.5 text-sm text-steel-700">{call.locationSummary}</p>
          ) : null}
          {call.notes ? <p className="mt-0.5 text-xs text-steel-600">{call.notes}</p> : null}
        </div>

        {puede && call.completedAt === null ? (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="shrink-0 rounded border border-steel-300 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('tracking.checkCalls.complete')}
          </button>
        ) : null}
      </div>

      {abierto ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            form.post(`/loads/${load.id}/check-calls/${call.id}/complete`, {
              preserveScroll: true,
              onSuccess: () => setAbierto(false),
            })
          }}
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-steel-100 pt-3"
        >
          <label className="flex min-w-56 flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('tracking.checkCalls.locationSummary')}</span>
            <input
              type="text"
              value={form.data.location_summary}
              onChange={(e) => form.setData('location_summary', e.target.value)}
              className={CAMPO}
            />
          </label>
          <label className="flex min-w-56 flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('tracking.checkCalls.notes')}</span>
            <input
              type="text"
              value={form.data.notes}
              onChange={(e) => form.setData('notes', e.target.value)}
              className={CAMPO}
            />
          </label>
          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {t('tracking.checkCalls.complete')}
          </button>
        </form>
      ) : null}
    </li>
  )
}

function Enlaces({
  load, links, habilitado, horasPorDefecto, puedeCrear, puedeRevocar,
}: {
  load: { id: string }
  links: TrackingLink[]
  habilitado: boolean
  horasPorDefecto: number
  puedeCrear: boolean
  puedeRevocar: boolean
}) {
  const { t } = useI18n()
  const form = useForm({ label: '', recipient_email: '', ttl_hours: String(horasPorDefecto) })

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <p className="text-sm font-semibold text-carbon">{t('tracking.publicLink.title')}</p>
      <p className="mt-0.5 text-xs text-steel-600">{t('tracking.publicLink.description')}</p>

      {! habilitado ? (
        <p className="mt-3 rounded border border-dashed border-steel-300 p-3 text-sm text-steel-700">
          {t('tracking.errors.publicTrackingDisabled')}
        </p>
      ) : null}

      {habilitado && puedeCrear ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            form.transform((d) => ({ ...d, ttl_hours: Number(d.ttl_hours) }))
            form.post(`/loads/${load.id}/tracking-links`, {
              preserveScroll: true,
              onSuccess: () => form.reset(),
            })
          }}
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-steel-100 pt-3"
        >
          <label className="flex min-w-56 flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('tracking.publicLink.labelField')}</span>
            <input
              type="text"
              value={form.data.label}
              onChange={(e) => form.setData('label', e.target.value)}
              placeholder={t('tracking.publicLink.labelPlaceholder')}
              className={CAMPO}
            />
          </label>
          <label className="flex min-w-56 flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">
              {t('tracking.publicLink.recipientEmailField')}
            </span>
            <input
              type="email"
              value={form.data.recipient_email}
              onChange={(e) => form.setData('recipient_email', e.target.value)}
              className={CAMPO}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('tracking.publicLink.ttlField')}</span>
            <input
              type="number"
              min="1"
              max="720"
              value={form.data.ttl_hours}
              onChange={(e) => form.setData('ttl_hours', e.target.value)}
              className={`${CAMPO} w-28`}
            />
          </label>
          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {t('tracking.publicLink.createButton')}
          </button>
        </form>
      ) : null}

      {links.length === 0 ? (
        <p className="mt-3 text-sm text-steel-600">{t('tracking.publicLink.empty')}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 rounded border border-steel-200 p-3">
              <div className="min-w-0">
                <p className="text-sm text-carbon">
                  {l.label ?? '—'}
                  <span className="ml-2 text-xs text-steel-600">
                    {t(`tracking.publicLink.status.${l.state}`)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-steel-600">
                  {t('tracking.publicLink.expiresAt', { date: l.expiresAt })}
                  {' · '}
                  {t('tracking.publicLink.viewCount', { n: String(l.viewCount) })}
                  {l.lastViewedAt
                    ? ` · ${t('tracking.publicLink.lastViewedAt', { date: l.lastViewedAt })}`
                    : ''}
                </p>
                {l.recipientEmail ? (
                  <p className="text-xs text-steel-600">{l.recipientEmail}</p>
                ) : null}
              </div>

              {puedeRevocar && l.state === 'active' ? (
                <RevocarBoton loadId={load.id} linkId={l.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RevocarBoton({ loadId, linkId }: { loadId: string; linkId: string }) {
  const { t } = useI18n()
  const form = useForm({})

  return (
    <button
      type="button"
      disabled={form.processing}
      onClick={() => form.post(`/loads/${loadId}/tracking-links/${linkId}/revoke`, { preserveScroll: true })}
      className="shrink-0 rounded border border-danger-300 px-3 py-1.5 text-xs font-medium text-danger-700 transition hover:bg-danger-50 disabled:opacity-50"
    >
      {t('tracking.publicLink.revokeButton')}
    </button>
  )
}

const CAMPO =
  'rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'

/**
 * La sesión de rastreo, con la puerta del consentimiento delante.
 *
 * Dice POR QUÉ no se puede empezar y no solo que no: sin conductor asignado no
 * hay a quién pedirle permiso, y sin su consentimiento no se empieza. Las dos
 * cosas mandan a sitios distintos —una a la carga, otra a la ficha del
 * conductor— y confundirlas cuesta una llamada.
 *
 * Y dice lo que la sesión NO trae: posiciones. El proveedor de GPS no está
 * conectado y esta pantalla lo ha dicho siempre; abrir una sesión no lo cambia.
 */
function Sesion({
  load, session, puede,
}: {
  load: { id: string }
  session: Props['session']
  puede: boolean
}) {
  const { t } = useI18n()
  const form = useForm({})

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <p className="text-sm font-semibold text-carbon">{t('tracking.session.title')}</p>
      <p className="mt-0.5 text-xs text-steel-600">{t('tracking.session.panelHint')}</p>

      <p className="mt-3 text-sm text-steel-700">
        {session.running
          ? t('tracking.session.startedAt', { date: session.startedAt ?? '' })
          : t('tracking.session.notStarted')}
        {session.driver !== null ? (
          <>
            {' · '}
            <Link
              href={`/drivers/${session.driver.id}`}
              className="font-medium text-navy-700 hover:underline"
            >
              {session.driver.name}
            </Link>
          </>
        ) : null}
      </p>

      {! session.running && session.blockedBy !== null ? (
        <p className="mt-2 rounded border border-warning-300 bg-warning-50 p-2 text-sm text-carbon">
          {t(`tracking.errors.${session.blockedBy}`)}
        </p>
      ) : null}

      {puede ? (
        <button
          type="button"
          disabled={form.processing || (! session.running && session.blockedBy !== null)}
          onClick={() =>
            form.post(`/loads/${load.id}/tracking/${session.running ? 'stop' : 'start'}`, {
              preserveScroll: true,
            })
          }
          className={`mt-3 rounded px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50 ${
            session.running ? 'bg-danger-500 hover:bg-danger-700' : 'bg-navy-700 hover:bg-navy-800'
          }`}
        >
          {session.running ? t('tracking.session.stopButton') : t('tracking.session.startButton')}
        </button>
      ) : null}
    </section>
  )
}
