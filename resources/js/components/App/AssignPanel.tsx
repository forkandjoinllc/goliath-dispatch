import { router, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n'

interface EligibilityItem {
  type: string
  value: string | null
  outcome: 'meets' | 'fails' | 'unknown'
  reason: string
  stale: boolean
  sourceMissing: boolean
}

interface Eligibility {
  verdict: 'meets' | 'fails' | 'unknown'
  meets: number
  fails: number
  unknown: number
  items: EligibilityItem[]
}

interface Option {
  id: string
  label: string
  ok: boolean
  problem: string | null
  licenseExpiresAt?: string | null
  medicalCardExpiresAt?: string | null
  /** Solo en conductores, y solo si la carga tiene requisitos. */
  eligibility?: Eligibility | null
}

interface Requirement {
  id: string
  type: string
  value: string | null
  source: string | null
  notes: string | null
}

/** Solo la fecha: la columna es datetime(3) y los milisegundos son ruido. */
function day(value: string | null | undefined): string {
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

export interface Assignable {
  carriers: { id: string; name: string; dispatchFeeBps: number }[]
  trucks: Option[]
  trailers: Option[]
  drivers: Option[]
  requirements?: Requirement[]
}

interface Props {
  loadId: string
  carrierId: string | null
  carrierRateCents: number | null
  assignable: Assignable
  can: { assignCarrier: boolean; assignResources: boolean }
}

/**
 * Poner transportista, camión, remolque y conductor.
 *
 * Un recurso que no está en regla se enseña TACHADO y con el motivo, no se
 * oculta. Ocultar al conductor con la licencia vencida dejaría a quien despacha
 * buscándolo en la lista; enseñarlo con «licencia vencida el 3 de marzo» le dice
 * qué hay que arreglar y a quién llamar.
 *
 * Se puede intentar elegirlo igual: el servidor lo rechaza y explica por qué.
 * Que la pantalla lo desactive es una comodidad, no la defensa — una petición a
 * mano se salta la pantalla entera.
 */
export function AssignPanel({ loadId, carrierId, carrierRateCents, assignable, can }: Props) {
  const { t } = useI18n()

  return (
    <section className="rounded border border-steel-200 bg-white p-5">
      <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
        {t('loads.assign.title')}
      </h2>

      <div className="mt-3 flex flex-col gap-4">
        {can.assignCarrier ? (
          <CarrierPicker
            loadId={loadId}
            carrierId={carrierId}
            rateCents={carrierRateCents}
            carriers={assignable.carriers}
          />
        ) : null}

        {can.assignResources ? (
          carrierId === null ? (
            <p className="rounded border-l-4 border-safety-500 bg-safety-50 p-2.5 text-xs">
              {t('loads.assign.needsCarrierFirst')}
            </p>
          ) : (
            <>
              <ResourcePicker loadId={loadId} type="truck" options={assignable.trucks} />
              <ResourcePicker loadId={loadId} type="trailer" options={assignable.trailers} />
              <ResourcePicker
                loadId={loadId}
                type="driver"
                options={assignable.drivers}
                requirements={assignable.requirements ?? []}
              />
            </>
          )
        ) : null}
      </div>
    </section>
  )
}

function CarrierPicker({
  loadId, carrierId, rateCents, carriers,
}: {
  loadId: string
  carrierId: string | null
  rateCents: number | null
  carriers: { id: string; name: string; dispatchFeeBps: number }[]
}) {
  const { t } = useI18n()
  const form = useForm({
    carrier_id: carrierId ?? '',
    carrier_gross_rate_cents: rateCents ?? 0,
  })

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-steel-700" htmlFor="assign-carrier">
        {t('loads.assign.carrier')}
      </label>
      <select
        id="assign-carrier"
        value={form.data.carrier_id}
        onChange={(e) => form.setData('carrier_id', e.target.value)}
        className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
      >
        <option value="">{t('loads.assign.chooseCarrier')}</option>
        {carriers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} · {(c.dispatchFeeBps / 100).toFixed(2).replace(/\.?0+$/, '')}%
          </option>
        ))}
      </select>
      <p className="text-xs text-steel-600">{t('loads.assign.onlyApproved')}</p>

      <label className="mt-1 text-xs font-medium text-steel-700" htmlFor="assign-rate">
        {t('loads.assign.rate')}
      </label>
      <input
        id="assign-rate"
        type="number"
        min={0}
        step={0.01}
        value={form.data.carrier_gross_rate_cents / 100}
        onChange={(e) =>
          form.setData('carrier_gross_rate_cents', Math.round(Number(e.target.value) * 100))
        }
        className="rounded border border-steel-300 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
      />
      <p className="text-xs text-steel-600">{t('loads.assign.rateHint')}</p>

      {form.errors.carrier_id ? (
        <p role="alert" className="rounded border-l-4 border-danger-500 bg-danger-50 p-2 text-xs">
          {form.errors.carrier_id}
        </p>
      ) : null}

      <button
        type="button"
        disabled={form.data.carrier_id === '' || form.processing}
        onClick={() => form.post(`/loads/${loadId}/carrier`, { preserveScroll: true })}
        className="mt-1 rounded bg-navy-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t('loads.assign.confirmCarrier')}
      </button>
    </div>
  )
}

function ResourcePicker({
  loadId, type, options, requirements = [],
}: {
  loadId: string
  type: 'truck' | 'trailer' | 'driver'
  options: Option[]
  requirements?: Requirement[]
}) {
  const { t } = useI18n()
  const [choice, setChoice] = useState('')
  const [error, setError] = useState<string | null>(null)

  const chosen = options.find((o) => o.id === choice)

  return (
    <div className="flex flex-col gap-1.5 border-t border-steel-100 pt-3">
      <label className="text-xs font-medium text-steel-700" htmlFor={`assign-${type}`}>
        {t(`loads.assign.${type}`)}
      </label>

      {options.length === 0 ? (
        <p className="text-xs text-steel-600">{t('loads.assign.noneAvailable')}</p>
      ) : (
        <>
          <select
            id={`assign-${type}`}
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value)
              setError(null)
            }}
            className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          >
            <option value="">{t(`loads.assign.choose${type[0]!.toUpperCase()}${type.slice(1)}`)}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {/* El motivo va en la propia opción: quien abre el desplegable
                    ve de una vez quién está en regla y quién no. */}
                {o.ok
                  ? `${o.label}${verdictTag(o.eligibility, t)}`
                  : `${o.label} — ${t(`loads.assign.${o.problem}`, {
                      name: o.label,
                      date: day(o.licenseExpiresAt ?? o.medicalCardExpiresAt),
                    })}`}
              </option>
            ))}
          </select>

          {chosen && !chosen.ok ? (
            <p role="alert" className="rounded border-l-4 border-safety-500 bg-safety-50 p-2 text-xs">
              {t(`loads.assign.${chosen.problem}`, {
                name: chosen.label,
                date: day(chosen.licenseExpiresAt ?? chosen.medicalCardExpiresAt),
              })}
            </p>
          ) : null}

          {/* Los requisitos de la carga NO descartan a nadie: se enseñan, y
              decide quien despacha. Por eso esto es un informe, no un bloqueo. */}
          {chosen?.eligibility ? (
            <EligibilityReport eligibility={chosen.eligibility} requirements={requirements} />
          ) : null}

          {error ? (
            <p role="alert" className="rounded border-l-4 border-danger-500 bg-danger-50 p-2 text-xs">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            disabled={choice === '' || (chosen !== undefined && !chosen.ok)}
            onClick={() =>
              router.post(
                `/loads/${loadId}/resources`,
                { resource_type: type, resource_id: choice },
                {
                  preserveScroll: true,
                  onError: (e) => setError(e.resource_id ?? null),
                  onSuccess: () => setChoice(''),
                },
              )
            }
            className="self-start rounded border border-navy-600 px-3 py-1.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t(`loads.assign.${type}`)}
          </button>
        </>
      )}
    </div>
  )
}

/**
 * La marca corta que va pegada al nombre en el desplegable.
 *
 * Tres palabras como mucho: el desplegable tiene que poder leerse de un
 * vistazo. El detalle está debajo, al elegir.
 */
function verdictTag(
  e: Eligibility | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!e || e.items.length === 0) return ''

  if (e.verdict === 'meets') return ` — ${t('loads.eligibility.meets')}`
  if (e.verdict === 'fails') return ` — ${t('loads.eligibility.failsShort', { n: String(e.fails) })}`

  return ` — ${t('loads.eligibility.unknownShort', { n: String(e.unknown) })}`
}

/**
 * Qué pide la carga y cómo queda este conductor, requisito a requisito.
 *
 * «No consta» se pinta distinto de «no cumple» a propósito. Lo primero se
 * arregla mirando un papel; lo segundo, buscando a otra persona. Pintarlos
 * igual haría que se ignoraran los dos.
 */
function EligibilityReport({
  eligibility, requirements,
}: { eligibility: Eligibility; requirements: Requirement[] }) {
  const { t } = useI18n()

  const tono: Record<string, string> = {
    meets: 'border-steel-300 bg-steel-50 text-steel-800',
    unknown: 'border-safety-400 bg-safety-50 text-safety-800',
    fails: 'border-danger-500 bg-danger-50 text-danger-800',
  }

  return (
    <div className="rounded border border-steel-200 bg-white p-2.5">
      <p className="text-xs font-semibold text-carbon">{t('loads.eligibility.title')}</p>

      <ul className="mt-2 flex flex-col gap-1.5">
        {eligibility.items.map((item, i) => {
          const fuente = requirements.find(
            (r) => r.type === item.type && (r.value ?? '') === (item.value ?? ''),
          )?.source

          return (
            <li key={i} className={`rounded border-l-4 px-2 py-1.5 text-xs ${tono[item.outcome]}`}>
              <span className="font-semibold">
                {t(`loads.requirementType.${item.type}`)}
                {item.value ? ` · ${item.value}` : ''}
              </span>
              {' — '}
              {t(item.reason)}
              {item.stale ? ` ${t('loads.eligibility.stale')}` : ''}
              {item.sourceMissing ? (
                <span className="mt-1 block font-medium">{t('loads.eligibility.sourceMissing')}</span>
              ) : fuente ? (
                <span className="mt-1 block text-steel-600">{fuente}</span>
              ) : null}
            </li>
          )
        })}
      </ul>

      <p className="mt-2 text-xs text-steel-600">{t('loads.eligibility.notABlock')}</p>
    </div>
  )
}
