import { Link, useForm } from '@inertiajs/react'
import { useState, type ReactNode } from 'react'
import { StatusBadge } from '@/components/App/StatusBadge'
import { SearchableSelect } from '@/components/Form/SearchableSelect'
import { TextField } from '@/components/Form/Field'
import { AppLayout } from '@/layouts/AppLayout'
import { formatDay } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

interface Props {
  driver: {
    id: string
    name: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
    preferredLocale: string
    status: string
    verificationStatus: string
    cdlClass: string | null
    licenseState: string | null
    licenseLast4: string | null
    licenseExpiresAt: string | null
    medicalCardExpiresAt: string | null
    expiries: { license: string | null; medical: string | null }
    endorsements: string[]
    restrictions: string[]
    verifiedAt: string | null
    verificationNotes: string | null
    trackingConsentAt: string | null
    hasLogin: boolean
    notes: string | null
    createdAt: string | null
  }
  carriers: {
    id: string
    name: string
    /** `null` cuando quien mira no puede abrir la ficha del transportista. */
    href: string | null
    onboardingStatus: string
    isPrimary: boolean
    startDate: string | null
    endDate: string | null
  }[]
  loads: {
    id: string
    loadNumber: string
    status: string
    commodity: string | null
    plannedPickupAt: string | null
  }[] | null
  standing: {
    current: Asignacion | null
    past: Asignacion[]
  }
  /** Nulo cuando quien mira no puede cambiar el equipo: no viaja la flota. */
  equipmentChoices: {
    trucks: { id: string; name: string }[]
    trailers: { id: string; name: string }[]
  } | null
  can: { update: boolean; approve: boolean; consent: boolean }
}

interface Asignacion {
  id: string
  truckId: string
  truck: string | null
  trailerId: string | null
  trailer: string | null
  startsOn: string
  endsOn: string | null
  notes: string | null
}

const VERIFICATION_TONE: Record<string, string> = {
  verified: 'bg-success-50 text-success-700 ring-success-500/40',
  not_started: 'bg-steel-100 text-steel-700 ring-steel-300',
  pending: 'bg-navy-100 text-navy-800 ring-navy-500/30',
  mismatch: 'bg-safety-100 text-safety-800 ring-safety-500/40',
  failed: 'bg-danger-50 text-danger-700 ring-danger-500/40',
  manually_overridden: 'bg-safety-100 text-safety-800 ring-safety-500/40',
  expired: 'bg-danger-50 text-danger-700 ring-danger-500/40',
}

export default function DriverShow({ driver, carriers, loads, standing, equipmentChoices, can }: Props) {
  const { t, locale } = useI18n()

  // Días de calendario. La ficha y el listado tenían el mismo ayudante copiado
  // y los dos movían la fecha un día. Ver `App\Support\Time\CalendarDates`.
  const day = (value: string | null): string => formatDay(value, locale)

  return (
    <AppLayout
      title={driver.name}
      crumbs={[{ label: t('drivers.index.title'), href: '/drivers' }, { label: driver.name }]}
      actions={
        can.update ? (
          <Link
            href={`/drivers/${driver.id}/edit`}
            className="rounded border border-steel-300 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('drivers.detail.edit')}
          </Link>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            VERIFICATION_TONE[driver.verificationStatus] ?? VERIFICATION_TONE.not_started
          }`}
        >
          {t(`drivers.verification.${driver.verificationStatus}`)}
        </span>
        <span className="text-sm text-steel-700">{t(`drivers.status.${driver.status}`)}</span>
        {driver.licenseLast4 ? (
          <span className="text-sm tabular-nums text-steel-600">
            {driver.licenseState} {t('drivers.detail.licenceMasked', { last4: driver.licenseLast4 })}
          </span>
        ) : null}
      </div>

      {/* Sin transportista no se le puede asignar una carga. Se dice arriba y
          no escondido en una tarjeta: es lo que bloquea todo lo demás. */}
      {carriers.length === 0 ? (
        <p className="mt-4 rounded border-l-4 border-safety-500 bg-safety-50 p-3 text-sm">
          {t('drivers.detail.noCarriers')}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title={t('drivers.detail.identity')}>
            <Dl>
              <Item label={t('drivers.detail.firstName')}>{driver.firstName}</Item>
              <Item label={t('drivers.detail.lastName')}>{driver.lastName}</Item>
              <Item label={t('drivers.detail.email')}>
                {driver.email ? (
                  <a href={`mailto:${driver.email}`} className="text-navy-700 hover:underline">
                    {driver.email}
                  </a>
                ) : (
                  '—'
                )}
              </Item>
              <Item label={t('drivers.detail.phone')}>{driver.phone ?? '—'}</Item>
              <Item label={t('drivers.detail.language')}>
                {driver.preferredLocale === 'es' ? 'Español' : 'English'}
              </Item>
              <Item label={t('drivers.detail.createdAt')}>{day(driver.createdAt)}</Item>
            </Dl>
          </Card>

          <Card title={t('drivers.detail.licence')}>
            <Dl>
              <Item label={t('drivers.detail.licenceNumber')}>
                {driver.licenseLast4
                  ? t('drivers.detail.licenceMasked', { last4: driver.licenseLast4 })
                  : '—'}
              </Item>
              <Item label={t('drivers.detail.licenceState')}>{driver.licenseState ?? '—'}</Item>
              <Item label={t('drivers.detail.cdlClass')}>
                {driver.cdlClass === null ? '—' : t(`drivers.cdlClass.${driver.cdlClass}`)}
              </Item>
              {/* Con su nombre, no unidos por comas.
                  Decía «H, N, T». Quien mira esta ficha para decidir si este
                  conductor puede llevar algo tenía que saberse la tabla de la
                  FMCSA de memoria, y un dato de cumplimiento que hay que
                  descifrar no se comprueba: se mira por encima.
                  Las restricciones —lo que NO puede conducir— no salían en
                  ningún sitio, con la columna llena. */}
              <Item label={t('drivers.detail.endorsements')}>
                <Codigos codigos={driver.endorsements} espacio="endorsements" />
              </Item>
              <Item label={t('drivers.detail.restrictions')}>
                <Codigos codigos={driver.restrictions} espacio="restrictions" />
              </Item>
              <Expiry
                label={t('drivers.detail.licenceExpires')}
                date={day(driver.licenseExpiresAt)}
                flag={driver.expiries.license}
              />
              <Expiry
                label={t('drivers.detail.medicalExpires')}
                date={day(driver.medicalCardExpiresAt)}
                flag={driver.expiries.medical}
              />
            </Dl>

            {/* Se dice por qué no está el número entero. Sin esta línea, alguien
                pensaría que falta el dato. */}
            <p className="mt-3 border-t border-steel-100 pt-3 text-xs text-steel-600">
              {t('drivers.detail.licenceHidden')}
            </p>
          </Card>

          <EquipoHabitual
            driverId={driver.id}
            standing={standing}
            choices={equipmentChoices}
            puedeEditar={can.update}
          />

          <Card title={t('drivers.detail.carriers')}>
            {carriers.length === 0 ? (
              <p className="text-sm text-steel-700">{t('drivers.detail.noCarriers')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-steel-100">
                {carriers.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                    {/* El conductor abre su propia ficha y no tiene
                        `carrier:read`. El servidor decide el enlace. */}
                    {c.href ? (
                      <Link
                        href={c.href}
                        className="font-medium text-navy-700 underline-offset-2 hover:underline"
                      >
                        {c.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-carbon">{c.name}</span>
                    )}
                    {c.isPrimary ? (
                      <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[11px] font-medium text-navy-800">
                        {t('drivers.detail.primary')}
                      </span>
                    ) : null}
                    <StatusBadge family="onboarding" value={c.onboardingStatus} />
                    <span className="ml-auto text-xs text-steel-600">
                      {c.endDate
                        ? t('drivers.detail.until', { date: String(c.endDate).slice(0, 10) })
                        : c.startDate
                          ? t('drivers.detail.since', { date: String(c.startDate).slice(0, 10) })
                          : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {loads ? (
            <Card title={t('drivers.detail.loads')}>
              {loads.length === 0 ? (
                <p className="text-sm text-steel-700">{t('drivers.detail.noLoads')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-steel-100">
                  {loads.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                      <Link
                        href={`/loads/${l.id}`}
                        className="font-medium tabular-nums text-navy-700 hover:underline"
                      >
                        {l.loadNumber}
                      </Link>
                      <span className="min-w-0 flex-1 truncate text-xs text-steel-600">
                        {l.commodity} · {day(l.plannedPickupAt)}
                      </span>
                      <StatusBadge family="load" value={l.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          <Card title={t('drivers.detail.notes')}>
            <p className="whitespace-pre-wrap text-sm text-carbon">
              {driver.notes ?? t('drivers.detail.noNotes')}
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title={t('drivers.detail.verification')}>
            <p className="text-sm text-carbon">
              {driver.verifiedAt
                ? `${t('drivers.detail.verifiedAt')}: ${day(driver.verifiedAt)}`
                : t('drivers.detail.verifiedNever')}
            </p>
            {driver.verificationNotes ? (
              <p className="mt-2 text-xs text-steel-700">{driver.verificationNotes}</p>
            ) : null}

            {can.approve ? <VerifyForm driverId={driver.id} /> : null}
          </Card>

          <Card title={t('drivers.detail.consent')}>
            <ConsentimientoDeRastreo
              driverId={driver.id}
              grantedAt={driver.trackingConsentAt}
              hasLogin={driver.hasLogin}
              mine={can.consent}
            />

            <Dl compact>
              <Item label={t('drivers.detail.trackingConsent')}>
                {driver.trackingConsentAt
                  ? t('drivers.detail.granted', { date: day(driver.trackingConsentAt) })
                  : t('drivers.detail.notGranted')}
              </Item>
              {/* Aquí había una fila de «consentimiento de SMS». Decía «No
                  otorgado» para TODOS los conductores, siempre, porque nadie
                  escribe nunca `drivers.sms_consent_granted_at`: no hay
                  pantalla que lo pida ni proceso que lo guarde. Y puesta al
                  lado del consentimiento de rastreo —que sí es real y sí se
                  otorga— parecía igual de real, como si faltara pedirlo.
                  Mientras no salga un SMS de esta aplicación, no hay nada que
                  consentir. Ver `App\Support\Notifications\Channels`. */}
              <Item label={t('drivers.detail.hasLogin')}>
                {driver.hasLogin ? t('common.labels.yes') : t('drivers.detail.noLogin')}
              </Item>
            </Dl>
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}

/**
 * Registrar la revisión de la licencia.
 *
 * Sale plegado: es un acto deliberado, no algo que se hace de paso mientras se
 * mira otra cosa.
 */
function VerifyForm({ driverId }: { driverId: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const form = useForm({ status: 'verified', notes: '' })

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded border border-navy-600 px-3 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
      >
        {t('drivers.verify.title')}
      </button>
    )
  }

  return (
    <div className="mt-3 border-t border-steel-100 pt-3">
      <p className="text-xs text-steel-600">{t('drivers.verify.hint')}</p>

      <label className="mt-2 block text-xs font-medium text-steel-700" htmlFor="verify-status">
        {t('drivers.verify.statusLabel')}
      </label>
      <select
        id="verify-status"
        value={form.data.status}
        onChange={(e) => form.setData('status', e.target.value)}
        className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
      >
        {['verified', 'mismatch', 'failed'].map((s) => (
          <option key={s} value={s}>
            {t(`drivers.verification.${s}`)}
          </option>
        ))}
      </select>

      <label className="mt-2 block text-xs font-medium text-steel-700" htmlFor="verify-notes">
        {t('drivers.verify.notesLabel')}
      </label>
      <textarea
        id="verify-notes"
        rows={3}
        value={form.data.notes}
        onChange={(e) => form.setData('notes', e.target.value)}
        className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
      />
      {form.errors.notes ? (
        <p role="alert" className="mt-1 text-xs text-danger-700">
          {form.errors.notes}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={form.processing}
          onClick={() =>
            form.post(`/drivers/${driverId}/verification`, {
              preserveScroll: true,
              onSuccess: () => setOpen(false),
            })
          }
          className="rounded bg-navy-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-navy-800 disabled:opacity-50"
        >
          {t('drivers.verify.action')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-steel-300 px-3 py-2 text-sm"
        >
          {t('common.actions.cancel')}
        </button>
      </div>
    </div>
  )
}

function Expiry({ label, date, flag }: { label: string; date: string; flag: string | null }) {
  const { t } = useI18n()

  return (
    <div className="min-w-0">
      <dt className="text-xs text-steel-600">{label}</dt>
      <dd className={`text-sm ${flag === 'expired' ? 'font-medium text-danger-700' : 'text-carbon'}`}>
        {date}
        {flag ? (
          <span
            className={`block text-xs font-medium ${
              flag === 'expired' ? 'text-danger-700' : 'text-safety-700'
            }`}
          >
            {t(flag === 'expired' ? 'drivers.detail.expired' : 'drivers.detail.expiringSoon')}
          </span>
        ) : null}
      </dd>
    </div>
  )
}

/**
 * El equipo habitual: con qué anda este conductor.
 *
 * Lo vigente arriba, lo de antes debajo, y el formulario solo si quien mira
 * puede cambiarlo. El historial no se borra: una carga de marzo se mira con el
 * camión que se llevó en marzo.
 */
function EquipoHabitual({
  driverId,
  standing,
  choices,
  puedeEditar,
}: {
  driverId: string
  standing: { current: Asignacion | null; past: Asignacion[] }
  choices: { trucks: { id: string; name: string }[]; trailers: { id: string; name: string }[] } | null
  puedeEditar: boolean
}) {
  const { t, locale } = useI18n()
  const [abierto, setAbierto] = useState(false)

  const form = useForm({
    truck_id: '',
    trailer_id: '',
    // En blanco y obligatoria: la persona la pone. Rellenarla con «hoy»
    // exigía construir una fecha en el navegador, y «hoy» en UTC es mañana
    // para media América — el guardián `CalendarDatesTest` lo vigila.
    starts_on: '',
    ends_on: '',
    notes: '',
  })

  const fin = useForm({})

  const camion = choices?.trucks.find((c) => c.id === form.data.truck_id) ?? null
  const remolque = choices?.trailers.find((c) => c.id === form.data.trailer_id) ?? null

  const tramo = (a: Asignacion): string => {
    const desde = t('drivers.standing.since', { date: formatDay(a.startsOn, locale) })

    return a.endsOn === null
      ? `${desde} · ${t('drivers.standing.open')}`
      : `${desde} ${t('drivers.standing.until', { date: formatDay(a.endsOn, locale) })}`
  }

  return (
    <Card title={t('drivers.standing.title')}>
      <p className="text-xs text-steel-600">{t('drivers.standing.hint')}</p>

      {standing.current === null ? (
        <p className="mt-3 text-sm text-steel-700">{t('drivers.standing.none')}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-steel-200 bg-steel-50 p-3">
          <span className="rounded bg-success-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-success-700">
            {t('drivers.standing.current')}
          </span>
          <span className="text-sm font-medium tabular-nums text-carbon">
            {standing.current.truck ?? '—'}
            {standing.current.trailer === null ? '' : ` · ${standing.current.trailer}`}
          </span>
          <span className="text-xs text-steel-600">{tramo(standing.current)}</span>
          {puedeEditar ? (
            <button
              type="button"
              disabled={fin.processing}
              onClick={() => {
                fin.post(`/drivers/${driverId}/equipment/${standing.current?.id ?? ""}/end`, {
                  preserveScroll: true,
                })
              }}
              className="ml-auto rounded border border-steel-300 px-2.5 py-1 text-xs font-medium text-navy-700 transition hover:bg-navy-50 disabled:opacity-50"
            >
              {t('drivers.standing.end')}
            </button>
          ) : null}
        </div>
      )}

      {standing.past.length === 0 ? null : (
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-steel-500">
            {t('drivers.standing.history')}
          </p>
          <ul className="mt-1 flex flex-col divide-y divide-steel-100">
            {standing.past.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-xs">
                <span className="font-medium tabular-nums text-navy-800">
                  {a.truck ?? "—"}
                  {a.trailer === null ? "" : ` · ${a.trailer}`}
                </span>
                <span className="text-steel-600">{tramo(a)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {puedeEditar && choices !== null ? (
        <div className="mt-4 border-t border-steel-100 pt-4">
          {abierto ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                form.post(`/drivers/${driverId}/equipment`, {
                  preserveScroll: true,
                  onSuccess: () => {
                    setAbierto(false)
                    form.reset()
                  },
                })
              }}
              className="flex flex-col gap-4"
            >
              <SearchableSelect
                label={t('drivers.standing.truck')}
                required
                choices={choices.trucks}
                selected={camion}
                onPick={(id) => form.setData('truck_id', id)}
                onClear={() => form.setData('truck_id', '')}
                placeholder={t('drivers.standing.chooseTruck')}
                emptyText={t('drivers.standing.noTruckMatches')}
                changeText={t('common.actions.change')}
                error={form.errors.truck_id}
              />

              {/* El remolque es opcional a propósito: en una flota donde los
                  remolques se sueltan y se recogen, exigirlo obligaría a
                  inventar uno. */}
              <SearchableSelect
                label={t('drivers.standing.trailer')}
                choices={choices.trailers}
                selected={remolque}
                onPick={(id) => form.setData('trailer_id', id)}
                onClear={() => form.setData('trailer_id', '')}
                placeholder={t('drivers.standing.chooseTrailer')}
                emptyText={t('drivers.standing.noTrailerMatches')}
                changeText={t('common.actions.change')}
                error={form.errors.trailer_id}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t('drivers.standing.startsOn')}
                  type="date"
                  required
                  value={form.data.starts_on}
                  onChange={(e) => form.setData('starts_on', e.target.value)}
                  error={form.errors.starts_on}
                />
                <TextField
                  label={t('drivers.standing.endsOn')}
                  hint={t('drivers.standing.endsOnHint')}
                  type="date"
                  value={form.data.ends_on}
                  onChange={(e) => form.setData('ends_on', e.target.value)}
                  error={form.errors.ends_on}
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={form.processing}
                  className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:opacity-50"
                >
                  {t('drivers.standing.save')}
                </button>
                <button
                  type="button"
                  onClick={() => { setAbierto(false) }}
                  className="rounded border border-steel-300 px-3 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                >
                  {t('common.actions.cancel')}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => { setAbierto(true) }}
              className="rounded border border-steel-300 px-3 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
            >
              {t('drivers.standing.save')}
            </button>
          )}
        </div>
      ) : null}
    </Card>
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

/**
 * El consentimiento de rastreo, con su botón — y solo para su dueño.
 *
 * La pantalla de rastreo prometía desde el primer día que «el rastreo no puede
 * iniciarse hasta que el conductor otorgue su consentimiento, y se detiene de
 * inmediato si se retira». No había ni puerta ni botón: la fecha se pintaba y
 * nadie podía ponerla ni quitarla.
 *
 * El botón aparece SOLO en la ficha de quien está mirando. Un administrador con
 * todos los permisos ve el estado y no ve el botón, y eso no es una limitación
 * que haya que arreglar: alguien marcando la casilla por otro no es esa persona
 * consintiendo.
 */
function ConsentimientoDeRastreo({
  driverId, grantedAt, hasLogin, mine,
}: {
  driverId: string
  grantedAt: string | null
  hasLogin: boolean
  mine: boolean
}) {
  const { t } = useI18n()
  const form = useForm({ action: grantedAt === null ? 'grant' : 'revoke' })

  const enviar = (action: 'grant' | 'revoke') => {
    form.transform((d) => ({ ...d, action }))
    form.post(`/drivers/${driverId}/tracking-consent`, { preserveScroll: true })
  }

  return (
    <div className="mb-3 rounded border border-steel-200 bg-steel-50 p-3">
      <p className="text-sm text-carbon">{t('tracking.consent.description')}</p>
      <p className="mt-1 text-xs text-steel-600">{t('tracking.consent.consentVersioned')}</p>
      <p className="text-xs text-steel-600">{t('tracking.consent.onlyDriverCan')}</p>

      {! hasLogin ? (
        <p className="mt-2 rounded border border-warning-300 bg-warning-50 p-2 text-sm text-carbon">
          {t('tracking.consent.noLogin')}
        </p>
      ) : null}

      {mine ? (
        <button
          type="button"
          disabled={form.processing}
          onClick={() => enviar(grantedAt === null ? 'grant' : 'revoke')}
          className={`mt-3 rounded px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50 ${
            grantedAt === null ? 'bg-navy-700 hover:bg-navy-800' : 'bg-danger-500 hover:bg-danger-700'
          }`}
        >
          {grantedAt === null
            ? t('tracking.consent.grantButton')
            : t('tracking.consent.revokeButton')}
        </button>
      ) : null}

      {/* Dicho en la pantalla y no solo en un comentario: esto es un registro y
          una puerta, no un dictamen sobre qué hay que pedir ni cómo. */}
      <p className="mt-2 text-[11px] text-steel-500">{t('tracking.consent.notLegalAdvice')}</p>
    </div>
  )
}

/** Los códigos de una licencia, cada uno con su nombre. */
function Codigos({ codigos, espacio }: { codigos: string[]; espacio: 'endorsements' | 'restrictions' }) {
  const { t } = useI18n()

  if (codigos.length === 0) {
    return <>—</>
  }

  return (
    <span className="flex flex-wrap gap-1">
      {codigos.map((c) => (
        <span key={c} className="rounded bg-navy-50 px-1.5 py-0.5 text-xs text-carbon">
          <span className="font-bold">{c}</span> — {t(`drivers.${espacio}.${c}`)}
        </span>
      ))}
    </span>
  )
}
