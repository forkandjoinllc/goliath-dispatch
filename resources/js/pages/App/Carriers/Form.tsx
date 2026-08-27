import { Link, router, useForm } from '@inertiajs/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { CountryStateFields } from '@/components/Form/CountryStateFields'
import { CheckboxField, SelectField, TextArea, TextField } from '@/components/Form/Field'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface CarrierDetail {
  id: string
  legalName: string
  dba: string | null
  dotNumber: string
  mcNumber: string | null
  contact: string
  email: string
  phone: string
  website: string | null
  preferredLocale: string
  dispatchFeeBps: number
  usesFactoring: boolean
  notes: string | null
  physical: {
    line1: string | null
    line2: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    country: string | null
  }
}

/** Lo que el registro federal devolvió, tal y como lo manda el servidor. */
interface FmcsaCarrier {
  dotNumber: string
  mcNumber: string | null
  legalName: string | null
  dba: string | null
  phone: string | null
  line1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  entityType: string | null
  operatingStatus: string | null
  allowedToOperate: boolean | null
  safetyRating: string | null
  safetyRatingDate: string | null
  powerUnits: number | null
  driverCount: number | null
}

interface Lookup {
  status: 'idle' | 'found' | 'not_found' | 'invalid' | 'error' | 'throttled'
  /** Falso cuando contestó el adaptador simulado: no se consultó nada. */
  live: boolean
  provider: string
  carrier: FmcsaCarrier | null
  /** El transportista que YA existe con ese USDOT en esta empresa, si lo hay. */
  existing: { id: string; legalName: string } | null
  message: string | null
  retryAfter?: number
}

interface Props {
  carrier: CarrierDetail | null
  canSetFee: boolean
  factoringCompanies: { id: string; name: string }[]
  /** La factoring que ya tiene asignada, al editar. */
  factoringCompanyId?: string | null
  /** Solo en el alta. Al editar no se consulta nada. */
  lookup?: Lookup | null
}

/**
 * Alta y edición de un transportista.
 *
 * Un solo componente para las dos cosas porque los campos son idénticos; lo
 * único que cambia es el verbo y el destino. Duplicarlo garantizaría que dentro
 * de tres meses uno de los dos tenga un campo que el otro no.
 *
 * La tarifa de despacho se apaga cuando el usuario no puede cambiarla. Eso NO es
 * la defensa: el controlador descarta el campo aunque llegue en la petición. Es
 * cortesía, para que nadie escriba un número que va a desaparecer al guardar.
 */
export default function CarrierForm({
  carrier,
  canSetFee,
  factoringCompanies,
  factoringCompanyId = null,
  lookup = null,
}: Props) {
  const { t } = useI18n()
  const editing = carrier !== null

  const found = lookup?.status === 'found' ? lookup.carrier : null

  // «A mano» se enciende de dos maneras: porque el registro no encontró nada y
  // el alta tiene que poder seguir igual, o porque alguien desbloqueó a
  // propósito un dato traído de FMCSA para corregirlo.
  const [manual, setManual] = useState(false)

  // Los campos que vinieron del registro se bloquean SOLO si la consulta fue
  // real. Bloquear campos rellenados por el adaptador simulado sería obligar a
  // guardar datos inventados.
  const locked = !editing && found !== null && lookup?.live === true && !manual

  const [firstName, ...restName] = (carrier?.contact ?? '').split(' ')

  const form = useForm({
    legal_name: carrier?.legalName ?? found?.legalName ?? '',
    dba: carrier?.dba ?? found?.dba ?? '',
    dot_number: carrier?.dotNumber ?? found?.dotNumber ?? '',
    mc_number: carrier?.mcNumber ?? found?.mcNumber ?? '',
    contact_first_name: carrier ? (firstName ?? '') : '',
    contact_last_name: carrier ? restName.join(' ') : '',
    email: carrier?.email ?? '',
    phone: carrier?.phone ?? found?.phone ?? '',
    website: carrier?.website ?? '',
    preferred_locale: carrier?.preferredLocale ?? 'en',
    physical_line1: carrier?.physical.line1 ?? found?.line1 ?? '',
    physical_line2: carrier?.physical.line2 ?? '',
    physical_city: carrier?.physical.city ?? found?.city ?? '',
    physical_country: carrier?.physical.country ?? found?.country ?? 'US',
    physical_state: carrier?.physical.state ?? found?.state ?? '',
    physical_postal_code: carrier?.physical.postalCode ?? found?.postalCode ?? '',
    // Puntos básicos, igual que la columna. El campo enseña el porcentaje y
    // convierte al escribir: el dinero se guarda en enteros para que no haya
    // redondeos, pero nadie escribe «1000» queriendo decir diez por ciento.
    //
    // Se guarda en bps y no en porcentaje porque así el nombre de la clave
    // coincide con el del servidor, y los errores de validación llegan al campo
    // correcto sin traducir nombres a mano.
    dispatch_fee_bps: carrier?.dispatchFeeBps ?? 1000,
    uses_factoring: carrier?.usesFactoring ?? false,
    factoring_company_id: factoringCompanyId ?? '',
    notes: carrier?.notes ?? '',
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()

    if (editing) {
      form.patch(`/carriers/${carrier.id}`)
    } else {
      form.post('/carriers')
    }
  }

  const crumbs = [
    { label: t('carriers.index.title'), href: '/carriers' },
    ...(editing ? [{ label: carrier.legalName, href: `/carriers/${carrier.id}` }] : []),
    { label: t(editing ? 'carriers.form.editTitle' : 'carriers.form.createTitle') },
  ]

  // Paso uno: el número y nada más. Un transportista ya existe en el registro
  // federal antes de existir aquí, y empezar por el nombre es lo que produce
  // duplicados escritos de dos maneras distintas.
  if (!editing && found === null && !manual) {
    return (
      <AppLayout
        title={t('carriers.form.createTitle')}
        description={t('carriers.form.lookupSubtitle')}
        crumbs={crumbs}
      >
        <LookupStep lookup={lookup} onManual={() => setManual(true)} />
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title={t(editing ? 'carriers.form.editTitle' : 'carriers.form.createTitle')}
      description={t(editing ? 'carriers.form.editSubtitle' : 'carriers.form.createSubtitle')}
      crumbs={crumbs}
    >
      <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6">
        {found !== null ? (
          <SourceBanner
            lookup={lookup as Lookup}
            carrier={found}
            locked={locked}
            onUnlock={() => setManual(true)}
          />
        ) : null}

        <Section title={t('carriers.form.identity')}>
          <TextField
            label={t('carriers.form.legalName')}
            hint={locked ? t('carriers.form.fromRegistry') : t('carriers.form.legalNameHint')}
            required
            disabled={locked}
            maxLength={200}
            value={form.data.legal_name}
            onChange={(e) => form.setData('legal_name', e.target.value)}
            error={form.errors.legal_name}
          />
          <TextField
            label={t('carriers.form.dba')}
            disabled={locked}
            maxLength={200}
            value={form.data.dba}
            onChange={(e) => form.setData('dba', e.target.value)}
            error={form.errors.dba}
          />
          <TextField
            label={t('carriers.form.dotNumber')}
            hint={locked ? t('carriers.form.fromRegistry') : t('carriers.form.dotNumberHint')}
            required
            disabled={locked}
            inputMode="numeric"
            maxLength={12}
            value={form.data.dot_number}
            onChange={(e) => form.setData('dot_number', e.target.value.replace(/\D/g, ''))}
            error={form.errors.dot_number}
          />
          <TextField
            label={t('carriers.form.mcNumber')}
            disabled={locked}
            inputMode="numeric"
            maxLength={12}
            value={form.data.mc_number}
            onChange={(e) => form.setData('mc_number', e.target.value.replace(/\D/g, ''))}
            error={form.errors.mc_number}
          />
        </Section>

        <Section title={t('carriers.form.contact')}>
          <TextField
            label={t('carriers.form.firstName')}
            required
            maxLength={100}
            value={form.data.contact_first_name}
            onChange={(e) => form.setData('contact_first_name', e.target.value)}
            error={form.errors.contact_first_name}
          />
          <TextField
            label={t('carriers.form.lastName')}
            required
            maxLength={100}
            value={form.data.contact_last_name}
            onChange={(e) => form.setData('contact_last_name', e.target.value)}
            error={form.errors.contact_last_name}
          />
          <TextField
            label={t('carriers.form.email')}
            type="email"
            required
            maxLength={255}
            value={form.data.email}
            onChange={(e) => form.setData('email', e.target.value)}
            error={form.errors.email}
          />
          <TextField
            label={t('carriers.form.phone')}
            type="tel"
            required
            maxLength={32}
            value={form.data.phone}
            onChange={(e) => form.setData('phone', e.target.value)}
            error={form.errors.phone}
          />
          <TextField
            label={t('carriers.form.website')}
            type="url"
            maxLength={255}
            placeholder="https://"
            value={form.data.website}
            onChange={(e) => form.setData('website', e.target.value)}
            error={form.errors.website}
          />
          <SelectField
            label={t('carriers.form.preferredLocale')}
            hint={t('carriers.form.preferredLocaleHint')}
            required
            value={form.data.preferred_locale}
            onChange={(e) => form.setData('preferred_locale', e.target.value)}
            options={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' },
            ]}
            error={form.errors.preferred_locale}
          />
        </Section>

        <Section title={t('carriers.form.address')}>
          <div className="sm:col-span-2">
            <TextField
              label={t('carriers.form.line1')}
              hint={locked ? t('carriers.form.fromRegistry') : undefined}
              disabled={locked}
              maxLength={200}
              value={form.data.physical_line1}
              onChange={(e) => form.setData('physical_line1', e.target.value)}
              error={form.errors.physical_line1}
            />
          </div>
          <TextField
            label={t('carriers.form.line2')}
            maxLength={200}
            value={form.data.physical_line2}
            onChange={(e) => form.setData('physical_line2', e.target.value)}
            error={form.errors.physical_line2}
          />
          <TextField
            label={t('carriers.form.city')}
            disabled={locked}
            maxLength={120}
            value={form.data.physical_city}
            onChange={(e) => form.setData('physical_city', e.target.value)}
            error={form.errors.physical_city}
          />
          <CountryStateFields
            country={form.data.physical_country}
            state={form.data.physical_state}
            onChange={(v) =>
              form.setData((d) => ({ ...d, physical_country: v.country, physical_state: v.state }))
            }
            countryError={form.errors.physical_country}
            stateError={form.errors.physical_state}
            disabled={locked}
          />
          <TextField
            label={t('carriers.form.postalCode')}
            disabled={locked}
            maxLength={12}
            value={form.data.physical_postal_code}
            onChange={(e) => form.setData('physical_postal_code', e.target.value)}
            error={form.errors.physical_postal_code}
          />
        </Section>

        <Section title={t('carriers.form.commercial')}>
          <TextField
            label={t('carriers.form.dispatchFee')}
            hint={canSetFee ? t('carriers.form.dispatchFeeHint') : t('carriers.form.dispatchFeeLocked')}
            type="number"
            min={0}
            max={100}
            step={0.25}
            disabled={!canSetFee}
            value={form.data.dispatch_fee_bps / 100}
            onChange={(e) =>
              form.setData('dispatch_fee_bps', Math.round(Number(e.target.value || 0) * 100))
            }
            error={form.errors.dispatch_fee_bps}
          />
          <div className="self-end">
            <CheckboxField
              label={t('carriers.form.usesFactoring')}
              checked={form.data.uses_factoring}
              onChange={(e) => form.setData('uses_factoring', e.target.checked)}
            />
          </div>

          {/* La lista aparece al marcar la casilla y no antes: un desplegable
              vacío junto a una casilla sin marcar solo invita a preguntarse qué
              hace ahí. Solo salen las ACTIVAS — una inactiva sigue valiendo para
              quien ya la tiene, pero no debe poder elegirse de nuevo. */}
          {form.data.uses_factoring ? (
            <div className="sm:col-span-2">
              <label className="block">
                <span className="block text-xs font-medium uppercase tracking-wide text-steel-700">
                  {t('carriers.form.factoringCompany')}
                </span>
                <select
                  value={form.data.factoring_company_id}
                  onChange={(e) => form.setData('factoring_company_id', e.target.value)}
                  className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
                >
                  <option value="">—</option>
                  {factoringCompanies.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-steel-600">
                  {t('carriers.form.factoringCompanyHint')}
                </span>
                {form.errors.factoring_company_id ? (
                  <span className="mt-1 block text-xs text-danger-700">
                    {form.errors.factoring_company_id}
                  </span>
                ) : null}
              </label>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <TextArea
              label={t('carriers.form.notes')}
              hint={t('carriers.form.notesHint')}
              maxLength={5000}
              value={form.data.notes}
              onChange={(e) => form.setData('notes', e.target.value)}
              error={form.errors.notes}
            />
          </div>
        </Section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-safety-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {form.processing
              ? t('common.states.saving')
              : t(editing ? 'carriers.form.saveChanges' : 'carriers.form.save')}
          </button>
          <Link
            href={editing ? `/carriers/${carrier.id}` : '/carriers'}
            className="rounded border border-steel-300 px-4 py-2.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('carriers.form.cancel')}
          </Link>
        </div>
      </form>
    </AppLayout>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded border border-steel-200 bg-white p-5">
      <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
        {title}
      </legend>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

/**
 * Paso uno del alta: el número.
 *
 * Un solo campo a la vez. La alternativa —enseñar los veinte campos y un botón
 * de «buscar» arriba— hace que la mitad de la gente rellene el formulario a
 * mano y no lo pulse nunca, que es exactamente lo que esta pantalla existe para
 * evitar.
 */
function LookupStep({ lookup, onManual }: { lookup: Lookup | null; onManual: () => void }) {
  const { t } = useI18n()
  const [dot, setDot] = useState('')
  const [mc, setMc] = useState('')
  const [buscando, setBuscando] = useState(false)

  const buscar = (e: React.FormEvent) => {
    e.preventDefault()

    if (dot.trim() === '' && mc.trim() === '') return

    setBuscando(true)
    router.get(
      '/carriers/create',
      dot.trim() !== '' ? { dot: dot.trim() } : { mc: mc.trim() },
      { preserveScroll: true, onFinish: () => setBuscando(false) },
    )
  }

  const estado = lookup?.status ?? 'idle'

  return (
    <form onSubmit={buscar} className="flex max-w-xl flex-col gap-5">
      <fieldset className="rounded border border-steel-200 bg-white p-5">
        <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
          {t('carriers.form.lookupTitle')}
        </legend>

        <p className="mt-2 text-sm text-steel-700">{t('carriers.form.lookupExplain')}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('carriers.form.dotNumber')}
            hint={t('carriers.form.dotNumberHint')}
            inputMode="numeric"
            maxLength={12}
            value={dot}
            onChange={(e) => setDot(e.target.value.replace(/\D/g, ''))}
          />
          <TextField
            label={t('carriers.form.mcNumber')}
            hint={t('carriers.form.lookupMcHint')}
            inputMode="numeric"
            maxLength={12}
            value={mc}
            onChange={(e) => setMc(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        {lookup !== null && lookup.live === false && estado !== 'idle' ? (
          <Notice tone="warn">{t('carriers.form.lookupNotLive')}</Notice>
        ) : null}

        {estado === 'not_found' ? <Notice tone="warn">{t('carriers.form.lookupNotFound')}</Notice> : null}
        {estado === 'invalid' ? <Notice tone="warn">{t('carriers.form.lookupInvalid')}</Notice> : null}
        {estado === 'error' ? <Notice tone="warn">{t('carriers.form.lookupError')}</Notice> : null}
        {estado === 'throttled' ? <Notice tone="warn">{t('carriers.form.lookupThrottled')}</Notice> : null}

        {lookup?.existing ? (
          <Notice tone="warn">
            {t('carriers.form.lookupDuplicate')}{' '}
            <Link href={`/carriers/${lookup.existing.id}`} className="font-semibold underline">
              {lookup.existing.legalName}
            </Link>
          </Notice>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={buscando || (dot.trim() === '' && mc.trim() === '')}
          className="rounded bg-safety-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {buscando ? t('common.states.loading') : t('carriers.form.lookupSubmit')}
        </button>

        {/* Que FMCSA no encuentre a alguien —o que esté caído— no puede impedir
            dar de alta a un transportista. Siempre hay salida a mano. */}
        <button
          type="button"
          onClick={onManual}
          className="rounded border border-steel-300 px-4 py-2.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
        >
          {t('carriers.form.lookupManual')}
        </button>

        <Link
          href="/carriers"
          className="text-sm font-medium text-navy-700 underline transition hover:text-navy-900"
        >
          {t('carriers.form.cancel')}
        </Link>
      </div>
    </form>
  )
}

/**
 * De dónde salió lo que hay en los campos.
 *
 * Va dentro del formulario y no en un tooltip porque es la respuesta a la
 * pregunta que se hace quien mira una ficha rellena sola: «¿esto lo escribió
 * alguien o lo trajo el sistema, y de dónde?».
 */
function SourceBanner({
  lookup,
  carrier,
  locked,
  onUnlock,
}: {
  lookup: Lookup
  carrier: FmcsaCarrier
  locked: boolean
  onUnlock: () => void
}) {
  const { t } = useI18n()

  const datos: [string, string | null][] = [
    [t('carriers.form.registryEntityType'), carrier.entityType],
    [t('carriers.form.registryOperatingStatus'), carrier.operatingStatus],
    [t('carriers.form.registrySafetyRating'), carrier.safetyRating],
    [t('carriers.form.registryPowerUnits'), carrier.powerUnits === null ? null : String(carrier.powerUnits)],
    [t('carriers.form.registryDrivers'), carrier.driverCount === null ? null : String(carrier.driverCount)],
  ]

  return (
    <div className="rounded border border-steel-200 bg-steel-50 p-4">
      {lookup.live ? (
        <p className="text-sm font-medium text-carbon">{t('carriers.form.registryFrom')}</p>
      ) : (
        <p className="text-sm font-medium text-safety-700">{t('carriers.form.lookupNotLive')}</p>
      )}

      {lookup.existing ? (
        <Notice tone="warn">
          {t('carriers.form.lookupDuplicate')}{' '}
          <Link href={`/carriers/${lookup.existing.id}`} className="font-semibold underline">
            {lookup.existing.legalName}
          </Link>
        </Notice>
      ) : null}

      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {datos.map(([etiqueta, valor]) => (
          <div key={etiqueta} className="flex justify-between gap-4 text-sm">
            <dt className="text-steel-600">{etiqueta}</dt>
            <dd className="font-medium text-carbon">{valor ?? '—'}</dd>
          </div>
        ))}
      </dl>

      {carrier.allowedToOperate === false ? (
        <Notice tone="warn">{t('carriers.form.registryNotAuthorized')}</Notice>
      ) : null}

      {locked ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-xs text-steel-600">{t('carriers.form.registryLocked')}</p>
          {/* Un candado sin llave acaba siendo un motivo para no usar la
              pantalla. El registro también se equivoca y va con retraso. */}
          <button
            type="button"
            onClick={onUnlock}
            className="rounded border border-steel-300 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('carriers.form.registryUnlock')}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-safety-700">{t('carriers.form.registryUnlocked')}</p>
      )}
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn'; children: ReactNode }) {
  return (
    <p
      className={
        tone === 'warn'
          ? 'mt-3 rounded border border-safety-300 bg-safety-50 px-3 py-2 text-sm text-safety-800'
          : 'mt-3 text-sm text-steel-700'
      }
    >
      {children}
    </p>
  )
}
