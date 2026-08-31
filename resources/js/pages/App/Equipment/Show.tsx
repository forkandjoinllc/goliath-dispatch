import { Link, useForm } from '@inertiajs/react'
import { useState, type ReactNode } from 'react'
import { StatusBadge } from '@/components/App/StatusBadge'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Props {
  type: 'trucks' | 'trailers'
  unit: Record<string, unknown> & {
    id: string
    unitNumber: string
    status: string
    expiries: { inspection: string | null; registration: string | null }
  }
  loads: {
    id: string
    loadNumber: string
    status: string
    commodity: string | null
    plannedPickupAt: string | null
    released: boolean
  }[] | null
  /**
   * Por qué esta unidad no puede ir a una carga, como claves de
   * `equipment.blocking.*`. Vienen del MISMO sitio que usa la puerta de
   * asignación: si esta pantalla dijera otra cosa, se descubriría el muro
   * chocándose con él.
   */
  blockingKeys: string[]
  verification: {
    status: string | null
    at: string | null
    by: string | null
    reason: string | null
    coiDocumentId: string | null
    coiExpiresOn: string | null
    obstacles: string[]
  }
  can: { update: boolean; changeStatus: boolean; override: boolean }
}

const STATUS_TONE: Record<string, string> = {
  active: 'bg-success-50 text-success-700 ring-success-500/40',
  pending_verification: 'bg-navy-100 text-navy-800 ring-navy-500/30',
  out_of_service: 'bg-danger-50 text-danger-700 ring-danger-500/40',
  archived: 'bg-steel-100 text-steel-600 ring-steel-300',
}

export default function EquipmentShow({ type, unit, loads, blockingKeys, verification, can }: Props) {
  const { t, locale } = useI18n()
  const s = (key: string): string => {
    const v = unit[key]
    return v === null || v === undefined || v === '' ? '—' : String(v)
  }
  const num = (key: string): number | null => {
    const v = unit[key]
    return typeof v === 'number' ? v : null
  }

  const day = (key: string): string => {
    const v = unit[key]
    return typeof v === 'string' && v !== ''
      ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { dateStyle: 'medium' }).format(
          new Date(v),
        )
      : '—'
  }

  const inches = (key: string): string => {
    const v = num(key)
    return v === null ? '—' : t('equipment.detail.inches', { value: v.toLocaleString() })
  }

  return (
    <AppLayout
      title={unit.unitNumber}
      crumbs={[
        {
          label: t(type === 'trucks' ? 'equipment.index.trucksTitle' : 'equipment.index.trailersTitle'),
          href: `/equipment/${type}`,
        },
        { label: unit.unitNumber },
      ]}
      actions={
        can.update ? (
          <Link
            href={`/equipment/${type}/${unit.id}/edit`}
            className="rounded border border-steel-300 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('equipment.detail.edit')}
          </Link>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            STATUS_TONE[unit.status] ?? STATUS_TONE.archived
          }`}
        >
          {t(`equipment.status.${unit.status}`)}
        </span>
        {unit.carrierId ? (
          <Link
            href={`/carriers/${String(unit.carrierId)}`}
            className="text-sm text-navy-700 underline-offset-2 hover:underline"
          >
            {s('carrier')}
          </Link>
        ) : null}
        <span className="text-sm text-steel-600">
          {[num('year'), s('make') !== '—' ? s('make') : null, s('model') !== '—' ? s('model') : null]
            .filter(Boolean)
            .join(' ')}
        </span>
      </div>

      {/* Lo que impide que esta unidad salga, arriba del todo y en una lista.
          Antes solo se explicaba «fuera de servicio»: una unidad sin verificar o
          con la inspección vencida no decía nada, y quien la buscaba en el
          desplegable de asignación no encontraba explicación en ninguna parte. */}
      {blockingKeys.length > 0 ? (
        <div className="mt-4 rounded border-l-4 border-danger-500 bg-danger-50 p-3 text-sm">
          <strong className="block">{t('equipment.blockingTitle')}</strong>
          <ul className="mt-1 list-disc pl-5">
            {blockingKeys.map((k) => (
              <li key={k}>{t(`equipment.blocking.${k}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Verificacion
        type={type}
        unitId={unit.id}
        vin={s('vin')}
        verification={verification}
        can={can}
      />

      {/* El motivo de estar fuera de servicio. Es lo que explica por qué
          esta unidad no aparece en ningún selector de asignación. */}
      {unit.status === 'out_of_service' && unit.outOfServiceReason ? (
        <p className="mt-4 rounded border-l-4 border-danger-500 bg-danger-50 p-3 text-sm">
          <strong className="block">{t('equipment.status.outOfServiceSince')}</strong>
          {String(unit.outOfServiceReason)}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title={t('equipment.detail.identity')}>
            <Dl>
              <Item label={t('equipment.detail.unitNumber')}>{s('unitNumber')}</Item>
              <Item label={t('equipment.detail.vin')}>{s('vin')}</Item>
              <Item label={t('equipment.detail.year')}>{s('year')}</Item>
              <Item label={t('equipment.detail.make')}>{s('make')}</Item>
              <Item label={t('equipment.detail.model')}>{s('model')}</Item>
              <Item label={t('equipment.detail.createdAt')}>{day('createdAt')}</Item>
            </Dl>
          </Card>

          <Card title={t('equipment.detail.registration')}>
            <Dl>
              <Item label={t('equipment.detail.plate')}>
                {s('plateNumber')}
                {unit.plateState ? ` · ${String(unit.plateState)}` : ''}
              </Item>
              <Item label={t('equipment.detail.registrationNumber')}>{s('registrationNumber')}</Item>
              <Expiry
                label={t('equipment.detail.registrationExpires')}
                date={day('registrationExpiresAt')}
                flag={unit.expiries.registration}
              />
              <Item label={t('equipment.detail.lastInspection')}>{day('lastInspectionAt')}</Item>
              <Expiry
                label={t('equipment.detail.nextInspection')}
                date={day('nextInspectionDueAt')}
                flag={unit.expiries.inspection}
              />
              <Item label={t('equipment.detail.nextMaintenance')}>{day('nextMaintenanceDueAt')}</Item>
            </Dl>
          </Card>

          {type === 'trailers' ? (
            <Card title={t('equipment.detail.dimensions')}>
              <Dl>
                <Item label={t('equipment.detail.length')}>{inches('lengthInches')}</Item>
                <Item label={t('equipment.detail.width')}>{inches('widthInches')}</Item>
                <Item label={t('equipment.detail.deckHeight')}>{inches('deckHeightInches')}</Item>
                <Item label={t('equipment.detail.wellLength')}>{inches('wellLengthInches')}</Item>
                <Item label={t('equipment.detail.capacity')}>
                  {num('capacityPounds') === null
                    ? '—'
                    : t('equipment.detail.pounds', {
                        value: (num('capacityPounds') as number).toLocaleString(),
                      })}
                </Item>
                <Item label={t('equipment.detail.axles')}>{s('axleCount')}</Item>
                <Item label={t('equipment.detail.removableGooseneck')}>
                  {unit.removableGooseneck ? t('common.labels.yes') : t('common.labels.no')}
                </Item>
                <Item label={t('equipment.detail.extendable')}>
                  {unit.isExtendable ? t('common.labels.yes') : t('common.labels.no')}
                </Item>
              </Dl>
            </Card>
          ) : null}

          {loads ? (
            <Card title={t('equipment.detail.loads')}>
              {loads.length === 0 ? (
                <p className="text-sm text-steel-700">{t('equipment.detail.noLoads')}</p>
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
                        {l.commodity}
                        {l.released ? ` · ${t('equipment.detail.released')}` : ''}
                      </span>
                      <StatusBadge family="load" value={l.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          <Card title={t('equipment.detail.notes')}>
            <p className="whitespace-pre-wrap text-sm text-carbon">
              {unit.notes ? String(unit.notes) : t('equipment.detail.noNotes')}
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {can.changeStatus ? (
            <Card title={t('equipment.status.title')}>
              <StatusForm type={type} unitId={unit.id} current={unit.status} />
            </Card>
          ) : null}
        </div>
      </div>
    </AppLayout>
  )
}

/**
 * Cambiar el estado de servicio.
 *
 * El campo del motivo aparece solo cuando la unidad va a bajar de servicio.
 * Pedirlo siempre lo convertiría en un trámite y dejaría de significar nada; el
 * aviso de que la unidad se retirará de sus cargas se enseña ahí mismo, antes de
 * pulsar, no después.
 */
function StatusForm({
  type, unitId, current,
}: { type: string; unitId: string; current: string }) {
  const { t } = useI18n()
  const [status, setStatus] = useState(current)
  const form = useForm({ status: current, reason: '' })
  const goingDown = status === 'out_of_service' || status === 'archived'

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-steel-700" htmlFor="equipment-status">
        {t('equipment.status.change')}
      </label>
      <select
        id="equipment-status"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value)
          form.setData('status', e.target.value)
        }}
        className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
      >
        {['pending_verification', 'active', 'out_of_service', 'archived'].map((s) => (
          <option key={s} value={s}>
            {t(`equipment.status.${s}`)}
          </option>
        ))}
      </select>

      {goingDown ? (
        <>
          <label className="mt-1 text-xs font-medium text-steel-700" htmlFor="equipment-reason">
            {t('equipment.status.reason')}
          </label>
          <textarea
            id="equipment-reason"
            rows={3}
            value={form.data.reason}
            onChange={(e) => form.setData('reason', e.target.value)}
            className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
          <p className="text-xs text-safety-700">{t('equipment.status.reasonRequired')}</p>
        </>
      ) : null}

      {form.errors.reason ? (
        <p role="alert" className="rounded border-l-4 border-danger-500 bg-danger-50 p-2 text-xs">
          {form.errors.reason}
        </p>
      ) : null}

      <button
        type="button"
        disabled={form.processing || status === current}
        onClick={() => form.post(`/equipment/${type}/${unitId}/status`, { preserveScroll: true })}
        className="mt-1 rounded bg-navy-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t('equipment.status.change')}
      </button>
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
            {t(flag === 'expired' ? 'equipment.detail.expired' : 'equipment.detail.expiringSoon')}
          </span>
        ) : null}
      </dd>
    </div>
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

function Dl({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
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
 * La verificación contra la póliza del transportista.
 *
 * Lo que esta caja NO hace, y lo dice: leer el certificado. El sistema no saca
 * los VIN del PDF — los mira una persona. Decirlo en la pantalla es la
 * diferencia entre una herramienta que ayuda y una que se cree más lista de lo
 * que es: quien confirma tiene que saber que la responsabilidad de haberlo
 * mirado es suya.
 */
function Verificacion({
  type, unitId, vin, verification, can,
}: {
  type: 'trucks' | 'trailers'
  unitId: string
  vin: string
  verification: Props['verification']
  can: { changeStatus: boolean; override: boolean }
}) {
  const { t } = useI18n()
  const [abierto, setAbierto] = useState(false)
  const form = useForm({ action: 'confirm', reason: '' })

  const hecha = verification.status === 'verified' || verification.status === 'manually_overridden'
  const bloqueada = verification.obstacles.length > 0

  const enviar = (action: 'confirm' | 'override') => {
    form.transform((d) => ({ ...d, action }))
    form.post(`/equipment/${type}/${unitId}/verification`, {
      preserveScroll: true,
      onSuccess: () => {
        form.reset('reason')
        setAbierto(false)
      },
    })
  }

  return (
    <section className="mt-4 rounded border border-steel-200 bg-white p-4">
      <p className="text-sm font-semibold text-carbon">{t('equipment.verification.title')}</p>
      <p className="mt-0.5 text-xs text-steel-600">{t('equipment.verification.hint')}</p>

      <p className="mt-3 text-sm text-steel-700">
        {verification.status === 'verified'
          ? t('equipment.verification.verifiedOn', {
              date: verification.at ?? '',
              name: verification.by ?? '—',
            })
          : verification.status === 'manually_overridden'
            ? t('equipment.verification.overriddenOn', {
                date: verification.at ?? '',
                name: verification.by ?? '—',
              })
            : t('equipment.verification.none')}
      </p>

      {verification.reason ? (
        <p className="mt-1 rounded border border-warning-300 bg-warning-50 p-2 text-sm text-carbon">
          {verification.reason}
        </p>
      ) : null}

      {form.errors.action ? (
        <p role="alert" className="mt-2 rounded border-l-4 border-danger-500 bg-danger-50 p-2 text-sm">
          {form.errors.action}
        </p>
      ) : null}

      {bloqueada ? (
        <ul className="mt-2 flex flex-col gap-1">
          {verification.obstacles.map((o) => (
            <li key={o} className="rounded border border-warning-300 bg-warning-50 p-2 text-sm text-carbon">
              {t(`equipment.verification.${o}`)}
            </li>
          ))}
        </ul>
      ) : null}

      {! hecha && can.changeStatus ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-steel-600">{t('equipment.verification.notExtracted')}</p>

          <p className="text-sm text-carbon">
            <span className="font-mono">{vin}</span>
            {verification.coiDocumentId !== null ? (
              <>
                {' · '}
                {/* El enlace nombra el DOCUMENTO, no la sección. Y la fecha dice
                    cuándo vence la póliza, no que la unidad esté verificada:
                    decía «verificada contra el certificado del …» debajo de
                    «sin verificar», que es contradecirse en dos líneas. */}
                <Link
                  href={`/documents/${verification.coiDocumentId}`}
                  className="font-medium text-navy-700 hover:underline"
                >
                  {t('equipment.verification.openCoi')}
                </Link>
                {verification.coiExpiresOn !== null
                  ? ` · ${t('equipment.verification.coiExpiresOn', { date: verification.coiExpiresOn })}`
                  : ''}
              </>
            ) : null}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={form.processing || bloqueada}
              onClick={() => enviar('confirm')}
              className="rounded bg-navy-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
            >
              {t('equipment.verification.confirm')}
            </button>

            {can.override ? (
              <button
                type="button"
                onClick={() => setAbierto((v) => !v)}
                className="rounded border border-steel-300 bg-white px-3 py-1.5 text-sm font-medium text-carbon transition hover:bg-steel-50"
              >
                {t('equipment.verification.override')}
              </button>
            ) : null}
          </div>

          {abierto ? (
            <div className="rounded border border-warning-300 bg-warning-50 p-3">
              <p className="text-xs text-carbon">{t('equipment.verification.overrideHint')}</p>
              <textarea
                value={form.data.reason}
                onChange={(e) => form.setData('reason', e.target.value)}
                rows={3}
                className="mt-2 w-full rounded border border-steel-300 px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
              />
              {form.errors.reason ? (
                <p role="alert" className="mt-1 text-sm text-danger-700">{form.errors.reason}</p>
              ) : null}
              <button
                type="button"
                disabled={form.processing}
                onClick={() => enviar('override')}
                className="mt-2 rounded bg-warning-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-warning-800 disabled:opacity-50"
              >
                {t('equipment.verification.override')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
