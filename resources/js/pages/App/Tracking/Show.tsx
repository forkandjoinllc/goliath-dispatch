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
  /** Cuándo salió el correo con este enlace, o nulo si no salió ninguno. */
  sentAt: string | null
  expiresAt: string
  revokedAt: string | null
  viewCount: number
  lastViewedAt: string | null
  createdAt: string
  state: 'active' | 'expired' | 'revoked'
}

interface TimelineEntry {
  id: string
  /** Clave de `tracking.event.*`, no la frase: la pinta el cliente. */
  type: string
  /** Verdadero cuando lo anotó una persona de despacho, no un aparato. */
  reportedByPerson: boolean
  provider: string
  location: string | null
  at: string
  stopId: string | null
}

interface Props {
  load: { id: string; number: string; status: string }
  stops: Stop[]
  timeline: TimelineEntry[]
  checkCalls: CheckCall[]
  links: TrackingLink[]
  publicTrackingEnabled: boolean
  /** La carga va en camino y al cliente no se le ha mandado ningún enlace. */
  linkNeverSent: boolean
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
    /** El resumen que guarda la sesión. Nulos mientras no llegue un parte. */
    lastLocation: string | null
    lastEventAt: string | null
    health: string | null
    progress: { done: number; total: number }
    /** Nulo siempre hoy: sin millas no hay estimación que no sea inventada. */
    etaAt: string | null
    provider: string
    providerIsLive: boolean
    /** Falso en producción: la simulación es una herramienta de desarrollo. */
    canSimulate: boolean
  }
  can: { manage: boolean; createLink: boolean; revokeLink: boolean }
}

export default function TrackingShow({
  load, stops, timeline, checkCalls, links, publicTrackingEnabled, linkNeverSent, defaultTtlHours, newLinkUrl, session, can,
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

        {/* Lo primero de la pantalla cuando pasa, porque es lo que hay que
            arreglar y porque aquí llega quien pulsó el aviso del barrido. El
            sitio público le promete al cliente que recibe el enlace al
            despacharse la carga. */}
        {linkNeverSent && publicTrackingEnabled ? (
          <p className="rounded border-l-4 border-warning-500 bg-warning-50 p-3 text-sm text-carbon">
            {t('tracking.publicLink.neverSentWarning')}
          </p>
        ) : null}

        <Sesion load={load} session={session} puede={can.manage} />
        <Paradas load={load} stops={stops} puede={can.manage} />
        <LineaDeTiempo entradas={timeline} />
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

/**
 * Las paradas, y ahora también los botones para anotar que el camión llegó y
 * que salió.
 *
 * Ese par de botones es todo el defecto de este lote: `actual_arrival_at` se
 * leía aquí, en la ficha de la carga y en la página del cliente, y no había en
 * toda la aplicación una sola forma de escribirlo. El cliente veía «pendiente»
 * en cada parada para siempre, incluso con la carga entregada.
 */
function Paradas({
  load, stops, puede,
}: {
  load: { id: string }
  stops: Stop[]
  puede: boolean
}) {
  const { t } = useI18n()

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <p className="text-sm font-semibold text-carbon">{t('tracking.stopProgress.title')}</p>
      <p className="mt-0.5 text-xs text-steel-600">{t('tracking.stopProgress.hint')}</p>

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

            {puede ? (
              <AnotarParada
                load={load}
                stop={s}
                // Se puede anotar la llegada solo si TODAS las anteriores están
                // anotadas. El servidor ya lo exige —`earlierStopNotArrived`—;
                // sin esto la pantalla ofrecía el botón en las dos paradas y el
                // de la segunda no podía hacer otra cosa que fallar. Un control
                // que la puerta va a rechazar no es una comodidad, es una
                // trampa: es la misma lección del desplegable que no coincidía
                // con la puerta de asignación.
                puedeLlegar={stops.every((otra) => otra.sequence >= s.sequence || otra.arrivedAt !== null)}
              />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * El par de botones de una parada.
 *
 * La hora se puede corregir hacia atrás porque despacho se entera después: el
 * campo viene con «ahora» puesto y se cambia si hace falta. Hacia adelante lo
 * impide el servidor, no esto.
 *
 * Se enseña solo el botón que toca —llegada mientras no haya llegada, salida
 * después— en vez de los dos siempre con uno deshabilitado. Un botón apagado
 * invita a preguntarse por qué; no enseñarlo cuando no cabe es más claro y es
 * además lo que hacen las reglas del servidor.
 */
function AnotarParada({
  load, stop, puedeLlegar,
}: {
  load: { id: string }
  stop: Stop
  puedeLlegar: boolean
}) {
  const { t } = useI18n()
  const form = useForm({ event: 'arrived', occurred_at: ahoraLocal() })

  if (stop.departedAt !== null) {
    return null
  }

  const verbo = stop.arrivedAt === null ? 'arrived' : 'departed'

  if (verbo === 'arrived' && ! puedeLlegar) {
    return null
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="flex flex-col text-xs text-steel-600">
        {t('tracking.stopProgress.whenLabel')}
        <input
          type="datetime-local"
          value={form.data.occurred_at}
          onChange={(e) => form.setData('occurred_at', e.target.value)}
          className="mt-0.5 rounded border border-steel-300 px-2 py-1 text-sm text-carbon"
        />
      </label>
      <button
        type="button"
        disabled={form.processing}
        onClick={() => {
          // `transform` no encadena en esta versión de Inertia: devuelve void y
          // se aplica al siguiente envío. Dos sentencias, no una cadena.
          form.transform((d) => ({ ...d, event: verbo }))
          form.post(`/loads/${load.id}/stops/${stop.id}/progress`, { preserveScroll: true })
        }}
        className="rounded bg-navy-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
      >
        {t(`tracking.stopProgress.${verbo}Button`)}
      </button>
    </div>
  )
}

/** «Ahora» en el formato que quiere un `datetime-local`, en la hora del navegador. */
function ahoraLocal(): string {
  const d = new Date()
  const desplazado = new Date(d.getTime() - d.getTimezoneOffset() * 60000)

  return desplazado.toISOString().slice(0, 16)
}

/**
 * Lo que se sabe del viaje, en orden y con su procedencia.
 *
 * Cada línea dice si la anotó una persona o la reportó un aparato, y eso no es
 * un detalle de implementación que se le escape al usuario: es la diferencia
 * entre «el camión reportó» y «alguien nos dijo». Hoy son todas de personas, y
 * conviene que se vea.
 */
function LineaDeTiempo({ entradas }: { entradas: TimelineEntry[] }) {
  const { t } = useI18n()

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <p className="text-sm font-semibold text-carbon">{t('tracking.timeline.title')}</p>
      <p className="mt-0.5 text-xs text-steel-600">{t('tracking.timeline.hint')}</p>

      {entradas.length === 0 ? (
        <p className="mt-3 text-sm text-steel-600">{t('tracking.timeline.empty')}</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {entradas.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 border-l-2 border-steel-200 pl-3">
              <span className="text-sm font-medium text-carbon">{t(`tracking.event.${e.type}`)}</span>
              {e.location ? <span className="text-sm text-steel-700">{e.location}</span> : null}
              <span className="text-xs text-steel-600">{e.at}</span>
              <span className="text-xs text-steel-500">
                {e.reportedByPerson ? t('tracking.timeline.byPerson') : t('tracking.timeline.byProvider')}
              </span>
            </li>
          ))}
        </ol>
      )}
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

      {habilitado && puedeCrear ? <MandarEnlace load={load} /> : null}

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
                {/* Si SALIÓ y cuándo. Con la dirección sola, a un cliente que
                    dice que no le llegó nada solo se le puede contestar «a esa
                    dirección era». */}
                {l.recipientEmail !== null ? (
                  <p className="mt-0.5 text-xs text-steel-600">
                    {l.recipientEmail}
                    {' · '}
                    {l.sentAt !== null
                      ? t('tracking.publicLink.sentAt', { date: l.sentAt })
                      : t('tracking.publicLink.notSent')}
                  </p>
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
 * Y dice de dónde salen las posiciones. No hay proveedor de GPS conectado: las
 * que se ven las anota despacho, y la pantalla no puede dar a entender otra
 * cosa. Antes de este lote decía que la sesión no traía posiciones NINGUNAS,
 * que era verdad y ya no lo es.
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

      {session.running ? (
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-steel-600">
              {t('tracking.session.lastPosition')}
            </dt>
            <dd className="mt-0.5 text-sm text-carbon">
              {session.lastLocation ?? t('tracking.session.noPositionYet')}
              {/* La hora acompaña a la POSICIÓN, no a la sesión: sin sitio no
                  hay «desde cuándo», y enseñarla debajo de «aún no se ha
                  reportado ninguna posición» era decir dos cosas a la vez. */}
              {session.lastLocation !== null && session.lastEventAt !== null ? (
                <span className="block text-xs text-steel-600">
                  {t('tracking.session.lastPositionAt', { date: session.lastEventAt })}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-steel-600">{t('tracking.health.title')}</dt>
            <dd className="mt-0.5 text-sm text-carbon">
              {t(`tracking.health.${session.health ?? 'unknown'}`)}
              <span className="block text-xs text-steel-600">
                {session.progress.total === 0
                  ? t('tracking.session.noProgress')
                  : t('tracking.session.progress', {
                      done: session.progress.done,
                      total: session.progress.total,
                    })}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-steel-600">
              {t('tracking.session.provider')}
            </dt>
            <dd className="mt-0.5 text-sm text-carbon">
              {session.provider}
              {/* La llegada estimada NO se calcula, y el hueco se explica en vez
                  de dejarse en blanco: sin millas de ruta cualquier estimación
                  sería una hora inventada que alguien le promete a un cliente. */}
              <span className="block text-xs text-steel-600">
                {session.etaAt === null
                  ? t('tracking.session.noEta')
                  : t('tracking.session.eta', { date: session.etaAt })}
              </span>
            </dd>
          </div>
        </dl>
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

      {puede && session.running && session.canSimulate ? (
        <SimularMovimiento load={load} />
      ) : null}
    </section>
  )
}

/**
 * Avanzar el camión imaginario. Herramienta de desarrollo, y lo dice.
 *
 * Solo aparece sin proveedor de verdad atado. Con uno conectado, meter
 * posiciones inventadas en la misma tabla donde entran las suyas contaminaría el
 * único sitio donde se puede comprobar qué pasó de verdad — el servidor también
 * se niega, esto es solo no enseñar el botón.
 */
function SimularMovimiento({ load }: { load: { id: string } }) {
  const { t } = useI18n()
  const form = useForm({ minutes: '180' })

  return (
    <div className="mt-4 rounded border border-dashed border-steel-300 p-3">
      <p className="text-xs text-steel-600">{t('tracking.session.simulateHint')}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-steel-600">
          {t('tracking.session.simulateMinutesLabel')}
          <input
            type="number"
            min={1}
            value={form.data.minutes}
            onChange={(e) => form.setData('minutes', e.target.value)}
            className="mt-0.5 w-28 rounded border border-steel-300 px-2 py-1 text-sm text-carbon"
          />
        </label>
        <button
          type="button"
          disabled={form.processing}
          onClick={() => form.post(`/loads/${load.id}/tracking/simulate`, { preserveScroll: true })}
          className="rounded border border-steel-300 px-3 py-1.5 text-sm font-semibold text-carbon transition hover:bg-steel-50 disabled:opacity-50"
        >
          {t('tracking.session.simulateButton')}
        </button>
      </div>
    </div>
  )
}

/**
 * Mandar el enlace por correo a una dirección.
 *
 * El caso de «el cliente llama diciendo que no le llegó». Crea uno NUEVO en vez
 * de reenviar el anterior: del anterior solo se guarda el hash del token, así
 * que reenviarlo es imposible por construcción — y esa propiedad conviene
 * conservarla, no rodearla. Se dice en el texto de ayuda, para que nadie crea
 * que el enlace viejo dejó de valer.
 */
function MandarEnlace({ load }: { load: { id: string } }) {
  const { t } = useI18n()
  const form = useForm({ email: '' })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.post(`/loads/${load.id}/tracking-links/send`, {
          preserveScroll: true,
          onSuccess: () => form.reset(),
        })
      }}
      className="mt-3 flex flex-wrap items-end gap-3 border-t border-steel-100 pt-3"
    >
      <label className="flex min-w-56 flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('tracking.publicLink.sendTitle')}</span>
        <input
          type="email"
          required
          value={form.data.email}
          onChange={(e) => form.setData('email', e.target.value)}
          className={CAMPO}
        />
        <span className="text-[11px] text-steel-500">{t('tracking.publicLink.sendHint')}</span>
      </label>
      <button
        type="submit"
        disabled={form.processing}
        className="rounded border border-steel-300 bg-white px-4 py-2 text-sm font-medium text-carbon transition hover:bg-steel-50 disabled:opacity-50"
      >
        {t('tracking.publicLink.sendButton')}
      </button>
    </form>
  )
}
