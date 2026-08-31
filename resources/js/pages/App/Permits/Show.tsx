import { Link, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import { Marca } from './Index'

interface Exceso {
  dimension: string
  value: number
  limit: number
}

interface ResultadoEstado {
  state: string
  hasRules: boolean
  exceeds: Exceso[]
  permitLikely: boolean
  escortLikely: boolean
  policeEscortLikely: boolean
  lastReviewedAt: string | null
}

interface Evaluacion {
  id: string
  outcome: string
  permitLikely: boolean
  escortLikely: boolean
  policeEscortLikely: boolean
  inputs: Record<string, number | string | null>
  stateResults: ResultadoEstado[]
  warnings: string[]
  validationStatus: string
  validationNotes: string | null
  validatedAt: string | null
  evaluatedAt: string | null
}

interface Permiso {
  id: string
  state: string
  number: string | null
  type: string | null
  status: string
  issuedAt: string | null
  expiresAt: string | null
  costCents: number
  notes: string | null
}

interface Escolta {
  id: string
  type: string
  state: string | null
  provider: string | null
  contactName: string | null
  contactPhone: string | null
  agency: string | null
  scheduledFor: string | null
  status: string
  costCents: number
  notes: string | null
}

interface Props {
  load: {
    id: string
    number: string
    status: string | null
    widthInches: number | null
    heightInches: number | null
    lengthInches: number | null
    weightPounds: number | null
    grossWeightPounds: number | null
    axleConfiguration: string | null
    isOversize: boolean
    isOverweight: boolean
    oversizeValidatedAt: string | null
    permitReadyAt: string | null
  }
  route: {
    provider: string
    calculatedAt: string | null
    totalMiles: number | null
    states: { state: string; milesInState: number | null }[]
  } | null
  evaluation: Evaluacion | null
  permits: Permiso[]
  escorts: Escolta[]
  options: {
    states: string[]
    permitStatuses: string[]
    escortStatuses: string[]
    escortTypes: string[]
  }
  can: { evaluate: boolean; validate: boolean; manage: boolean; approveReady: boolean }
}

/**
 * Los papeles de una carga sobredimensionada.
 *
 * Lo primero que se ve es el aviso de que esto ORIENTA y no determina, y no
 * está ahí por costumbre: la evaluación compara cinco números contra cinco
 * números, y le faltan los estados de paso, los horarios, los puentes y las
 * excepciones que publica cada estado. Enseñar «sin restricciones» en verde sin
 * ese aviso sería la forma más cara de equivocarse que tiene este producto.
 */
export default function PermitsShow({
  load, route, evaluation, permits, escorts, options, can,
}: Props) {
  const { t } = useI18n()

  const dimensionesCambiaron =
    evaluation !== null &&
    (Number(evaluation.inputs.widthInches ?? -1) !== Number(load.widthInches ?? -1) ||
      Number(evaluation.inputs.heightInches ?? -1) !== Number(load.heightInches ?? -1) ||
      Number(evaluation.inputs.lengthInches ?? -1) !== Number(load.lengthInches ?? -1) ||
      Number(evaluation.inputs.grossWeightPounds ?? -1) !== Number(load.grossWeightPounds ?? -1))

  return (
    <AppLayout
      title={t('oversize.evaluation.title')}
      heading={load.number}
      crumbs={[
        { label: t('oversize.index.title'), href: '/permits' },
        { label: load.number },
      ]}
    >
      <div className="flex flex-col gap-4">
        <section className="rounded border border-warning-300 bg-warning-50 p-4">
          <p className="text-sm font-semibold text-carbon">{t('oversize.disclaimer.title')}</p>
          <p className="mt-1 text-xs text-carbon">{t('oversize.disclaimer.body')}</p>
        </section>

        <Recorrido route={route} />

        <section className="rounded border border-steel-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-carbon">{t('oversize.evaluation.title')}</p>
              <p className="mt-0.5 text-xs text-steel-600">{t('oversize.evaluation.description')}</p>
            </div>
            {can.evaluate ? <Evaluar loadId={load.id} yaHay={evaluation !== null} /> : null}
          </div>

          {evaluation === null ? (
            <p className="mt-3 text-sm text-steel-600">{t('oversize.evaluation.noEvaluationYet')}</p>
          ) : (
            <>
              {dimensionesCambiaron ? (
                <p className="mt-3 rounded border border-warning-300 bg-warning-50 p-3 text-sm text-carbon">
                  {t('oversize.evaluation.staleBanner')}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Resultado outcome={evaluation.outcome} />
                <span className="text-xs text-steel-600">
                  {t('oversize.evaluation.evaluatedAt', { date: evaluation.evaluatedAt ?? '—' })}
                </span>
              </div>
              <p className="mt-1 text-sm text-steel-700">
                {t(`oversize.outcomeDescription.${evaluation.outcome}`)}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <Requisito activo={evaluation.permitLikely} etiqueta={t('oversize.panel.permitColumn')} />
                <Requisito activo={evaluation.escortLikely} etiqueta={t('oversize.panel.escortColumn')} />
                <Requisito activo={evaluation.policeEscortLikely} etiqueta={t('oversize.panel.policeEscortColumn')} />
              </div>

              {evaluation.warnings.length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-steel-600">
                    {t('oversize.panel.missingDataTitle')}
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {evaluation.warnings.map((w) => (
                      <li key={w} className="rounded border border-warning-300 bg-warning-50 px-3 py-2 text-xs text-carbon">
                        <Aviso clave={w} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <PorEstado resultados={evaluation.stateResults} />

              <Validacion loadId={load.id} evaluation={evaluation} puede={can.validate} />
            </>
          )}
        </section>

        <Compuerta load={load} puede={can.approveReady} />

        <Permisos loadId={load.id} permits={permits} options={options} puede={can.manage} />

        <Escoltas loadId={load.id} escorts={escorts} options={options} puede={can.manage} />

        <Link href="/permits" className="text-sm font-medium text-navy-700 hover:underline">
          {t('oversize.index.title')}
        </Link>
      </div>
    </AppLayout>
  )
}

function Aviso({ clave }: { clave: string }) {
  const { t } = useI18n()
  const [base, estado] = clave.split(':')

  if (base === 'stateWithoutRules' && estado !== undefined) {
    return <>{t('oversize.warnings.stateWithoutRules', { state: estado })}</>
  }

  return <>{t(`oversize.warnings.${base}`)}</>
}

function Recorrido({ route }: { route: Props['route'] }) {
  const { t } = useI18n()

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <p className="text-sm font-semibold text-carbon">{t('oversize.route.title')}</p>

      {route === null ? (
        <p className="mt-2 text-sm text-steel-600">{t('oversize.route.noneYet')}</p>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-steel-600">
            {t('oversize.route.provider', {
              provider: route.provider === 'mock' ? t('oversize.route.mockProvider') : route.provider,
              date: route.calculatedAt ?? '—',
            })}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {route.states.map((e) => (
              <span key={e.state} className="rounded border border-steel-300 px-2 py-1 text-xs text-carbon">
                {e.state}
                {e.milesInState === null ? '' : ` · ${e.milesInState}`}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function Resultado({ outcome }: { outcome: string }) {
  const { t } = useI18n()

  const tono =
    outcome === 'clear' ? 'success' : outcome === 'insufficient_data' ? 'steel' : 'warning'

  return <Marca tono={tono as 'success' | 'warning' | 'steel'}>{t(`oversize.outcome.${outcome}`)}</Marca>
}

function Requisito({ activo, etiqueta }: { activo: boolean; etiqueta: string }) {
  const { t } = useI18n()

  return (
    <span className="rounded border border-steel-300 px-2.5 py-1 text-xs text-carbon">
      {etiqueta}: <strong>{activo ? t('oversize.panel.yes') : t('oversize.panel.no')}</strong>
    </span>
  )
}

function PorEstado({ resultados }: { resultados: ResultadoEstado[] }) {
  const { t } = useI18n()

  if (resultados.length === 0) {
    return <p className="mt-4 text-sm text-steel-600">{t('oversize.panel.stateResultsEmpty')}</p>
  }

  return (
    <div className="mt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-steel-600">
        {t('oversize.panel.stateResultsTitle')}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {resultados.map((r) => (
          <li key={r.state} className="rounded border border-steel-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-carbon">{r.state}</span>
              {r.permitLikely ? <Marca tono="warning">{t('oversize.panel.permitColumn')}</Marca> : null}
              {r.escortLikely ? <Marca tono="warning">{t('oversize.panel.escortColumn')}</Marca> : null}
              {r.policeEscortLikely ? <Marca tono="danger">{t('oversize.panel.policeEscortColumn')}</Marca> : null}
              {! r.hasRules ? <Marca tono="steel">—</Marca> : null}
            </div>

            {r.exceeds.length === 0 ? (
              <p className="mt-1 text-xs text-steel-600">{t('oversize.panel.noExceedances')}</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5">
                {r.exceeds.map((e, i) => (
                  <li key={i} className="text-xs text-carbon">
                    {t(`oversize.dimension.${e.dimension}`)}: <strong>{e.value.toLocaleString()}</strong>
                    {' > '}
                    {e.limit.toLocaleString()}
                  </li>
                ))}
              </ul>
            )}

            {/* La fecha de revisión importa tanto como los números: una regla
                sembrada y nunca mirada no vale lo mismo que una verificada. */}
            <p className="mt-1 text-[11px] text-steel-500">
              {r.lastReviewedAt === null
                ? t('oversize.rules.neverReviewed')
                : t('oversize.rules.lastReviewed', { date: r.lastReviewedAt })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Evaluar({ loadId, yaHay }: { loadId: string; yaHay: boolean }) {
  const { t } = useI18n()
  const form = useForm({ axle_weight_pounds: '' })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.transform((d) => ({
          ...d,
          axle_weight_pounds: d.axle_weight_pounds === '' ? null : Number(d.axle_weight_pounds),
        }))
        form.post(`/loads/${loadId}/permits/evaluate`, { preserveScroll: true })
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('oversize.evaluation.axleWeightLabel')}</span>
        <input
          type="number"
          min="0"
          value={form.data.axle_weight_pounds}
          onChange={(e) => form.setData('axle_weight_pounds', e.target.value)}
          className={`${CAMPO} w-40`}
        />
        <span className="text-[11px] text-steel-500">{t('oversize.evaluation.axleWeightHint')}</span>
      </label>
      <button
        type="submit"
        disabled={form.processing}
        className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
      >
        {form.processing
          ? t('oversize.evaluation.running')
          : yaHay
            ? t('oversize.evaluation.rerunButton')
            : t('oversize.evaluation.runButton')}
      </button>
    </form>
  )
}

function Validacion({
  loadId, evaluation, puede,
}: { loadId: string; evaluation: Evaluacion; puede: boolean }) {
  const { t } = useI18n()
  const form = useForm({ status: '', notes: '' })

  return (
    <div className="mt-4 border-t border-steel-100 pt-3">
      <p className="text-sm font-semibold text-carbon">{t('oversize.validation.title')}</p>
      <p className="mt-0.5 text-xs text-steel-600">{t('oversize.validation.description')}</p>

      <div className="mt-2">
        <Marca
          tono={
            evaluation.validationStatus === 'validated'
              ? 'success'
              : evaluation.validationStatus === 'rejected'
                ? 'danger'
                : 'steel'
          }
        >
          {t(`oversize.validation.status.${evaluation.validationStatus}`)}
        </Marca>
        {evaluation.validatedAt !== null ? (
          <span className="ml-2 text-xs text-steel-600">{evaluation.validatedAt}</span>
        ) : null}
      </div>

      {evaluation.validationNotes ? (
        <p className="mt-1 text-sm text-carbon">{evaluation.validationNotes}</p>
      ) : null}

      {! puede ? (
        <p className="mt-2 text-xs text-steel-600">{t('oversize.validation.adminOnly')}</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            form.post(`/loads/${loadId}/permits/validate`, { preserveScroll: true })
          }}
          className="mt-3 flex flex-col gap-2"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('oversize.validation.notesLabel')}</span>
            <textarea
              rows={2}
              value={form.data.notes}
              onChange={(e) => form.setData('notes', e.target.value)}
              placeholder={t('oversize.validation.notesPlaceholder')}
              className={CAMPO}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={form.processing}
              onClick={() => form.setData('status', 'validated')}
              className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
            >
              {t('oversize.validation.validateButton')}
            </button>
            <button
              type="submit"
              disabled={form.processing || form.data.notes.trim() === ''}
              onClick={() => form.setData('status', 'rejected')}
              className="rounded border border-danger-300 bg-white px-4 py-2 text-sm font-medium text-danger-700 transition hover:bg-danger-50 disabled:opacity-50"
            >
              {t('oversize.validation.rejectButton')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function Compuerta({ load, puede }: { load: Props['load']; puede: boolean }) {
  const { t } = useI18n()
  const form = useForm({})

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <p className="text-sm font-semibold text-carbon">{t('oversize.readiness.title')}</p>
      <p className="mt-0.5 text-xs text-steel-600">{t('oversize.readiness.description')}</p>

      <div className="mt-2">
        {load.permitReadyAt === null ? (
          <span className="text-sm text-steel-700">{t('oversize.readiness.notApproved')}</span>
        ) : (
          <Marca tono="success">{load.permitReadyAt}</Marca>
        )}
      </div>

      {puede && load.permitReadyAt === null ? (
        <button
          type="button"
          disabled={form.processing}
          onClick={() => form.post(`/loads/${load.id}/permits/ready`, { preserveScroll: true })}
          className="mt-3 rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
        >
          {t('oversize.readiness.approveButton')}
        </button>
      ) : null}
    </section>
  )
}

function Permisos({
  loadId, permits, options, puede,
}: { loadId: string; permits: Permiso[]; options: Props['options']; puede: boolean }) {
  const { t } = useI18n()
  const [abierto, setAbierto] = useState(false)
  const form = useForm({
    state_code: '', permit_number: '', permit_type: '', status: 'pending',
    issued_at: '', expires_at: '', cost_cents: '0', notes: '',
  })

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-carbon">{t('oversize.permits.title')}</p>
          <p className="mt-0.5 text-xs text-steel-600">{t('oversize.permits.description')}</p>
        </div>
        {puede ? (
          <button
            type="button"
            onClick={() => setAbierto(! abierto)}
            className="rounded border border-steel-300 bg-white px-3 py-2 text-sm font-medium text-carbon transition hover:bg-steel-50"
          >
            {t('oversize.permits.addButton')}
          </button>
        ) : null}
      </div>

      {abierto ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            form.transform((d) => ({ ...d, cost_cents: Number(d.cost_cents || 0) }))
            form.post(`/loads/${loadId}/permits/items`, {
              preserveScroll: true,
              onSuccess: () => { form.reset(); setAbierto(false) },
            })
          }}
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-steel-100 pt-3"
        >
          <Campo etiqueta={t('oversize.permits.stateLabel')}>
            <select value={form.data.state_code} onChange={(e) => form.setData('state_code', e.target.value)} className={CAMPO}>
              <option value="" />
              {options.states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t('oversize.permits.permitTypeLabel')}>
            <input type="text" value={form.data.permit_type} onChange={(e) => form.setData('permit_type', e.target.value)} className={CAMPO} />
          </Campo>
          <Campo etiqueta={t('oversize.permits.permitNumberLabel')}>
            <input type="text" value={form.data.permit_number} onChange={(e) => form.setData('permit_number', e.target.value)} className={CAMPO} />
          </Campo>
          <Campo etiqueta={t('oversize.permits.status.pending')}>
            <select value={form.data.status} onChange={(e) => form.setData('status', e.target.value)} className={CAMPO}>
              {options.permitStatuses.map((s) => (
                <option key={s} value={s}>{t(`oversize.permits.status.${s}`)}</option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta={t('oversize.permits.expiresAtLabel')}>
            <input type="date" value={form.data.expires_at} onChange={(e) => form.setData('expires_at', e.target.value)} className={CAMPO} />
          </Campo>
          <button
            type="submit"
            disabled={form.processing || form.data.state_code === ''}
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {t('oversize.permits.addButton')}
          </button>
        </form>
      ) : null}

      {permits.length === 0 ? (
        <p className="mt-3 text-sm text-steel-600">{t('oversize.permits.empty')}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {permits.map((p) => (
            <li key={p.id} className="rounded border border-steel-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-carbon">{p.state}</span>
                <Marca tono={p.status === 'issued' ? 'success' : p.status === 'rejected' || p.status === 'expired' ? 'danger' : 'steel'}>
                  {t(`oversize.permits.status.${p.status}`)}
                </Marca>
                {p.number ? <span className="font-mono text-xs text-steel-700">{p.number}</span> : null}
              </div>
              <p className="mt-0.5 text-xs text-steel-600">
                {p.type ?? '—'}
                {p.expiresAt ? ` · ${t('oversize.permits.expiringSoon', { date: p.expiresAt })}` : ''}
                {p.costCents > 0 ? ` · $${(p.costCents / 100).toFixed(2)}` : ''}
              </p>
              {p.notes ? <p className="mt-1 text-sm text-carbon">{p.notes}</p> : null}
              {puede ? <CambiarEstadoPermiso loadId={loadId} permiso={p} options={options} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CambiarEstadoPermiso({
  loadId, permiso, options,
}: { loadId: string; permiso: Permiso; options: Props['options'] }) {
  const { t } = useI18n()
  const form = useForm({
    status: permiso.status,
    permit_number: permiso.number ?? '',
    expires_at: permiso.expiresAt?.slice(0, 10) ?? '',
    cost_cents: String(permiso.costCents),
    notes: permiso.notes ?? '',
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.transform((d) => ({ ...d, cost_cents: Number(d.cost_cents || 0) }))
        form.post(`/loads/${loadId}/permits/items/${permiso.id}`, { preserveScroll: true })
      }}
      className="mt-2 flex flex-wrap items-end gap-2 border-t border-steel-100 pt-2"
    >
      <select value={form.data.status} onChange={(e) => form.setData('status', e.target.value)} className={`${CAMPO} text-xs`}>
        {options.permitStatuses.map((s) => (
          <option key={s} value={s}>{t(`oversize.permits.status.${s}`)}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={form.processing}
        className="rounded border border-steel-300 bg-white px-3 py-1.5 text-xs text-steel-700 transition hover:bg-steel-50 disabled:opacity-50"
      >
        {t('oversize.permits.editButton')}
      </button>
    </form>
  )
}

function Escoltas({
  loadId, escorts, options, puede,
}: { loadId: string; escorts: Escolta[]; options: Props['options']; puede: boolean }) {
  const { t } = useI18n()
  const [abierto, setAbierto] = useState(false)
  const form = useForm({
    escort_type: 'pilot_car', state_code: '', provider_name: '', contact_name: '',
    contact_phone: '', agency_name: '', scheduled_for: '', status: 'pending',
    cost_cents: '0', notes: '',
  })

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-carbon">{t('oversize.escorts.title')}</p>
          <p className="mt-0.5 text-xs text-steel-600">{t('oversize.escorts.description')}</p>
        </div>
        {puede ? (
          <button
            type="button"
            onClick={() => setAbierto(! abierto)}
            className="rounded border border-steel-300 bg-white px-3 py-2 text-sm font-medium text-carbon transition hover:bg-steel-50"
          >
            {t('oversize.escorts.addButton')}
          </button>
        ) : null}
      </div>

      {abierto ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            form.transform((d) => ({ ...d, cost_cents: Number(d.cost_cents || 0) }))
            form.post(`/loads/${loadId}/escorts`, {
              preserveScroll: true,
              onSuccess: () => { form.reset(); setAbierto(false) },
            })
          }}
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-steel-100 pt-3"
        >
          <Campo etiqueta={t('oversize.escorts.type.pilot_car')}>
            <select value={form.data.escort_type} onChange={(e) => form.setData('escort_type', e.target.value)} className={CAMPO}>
              {options.escortTypes.map((s) => (
                <option key={s} value={s}>{t(`oversize.escorts.type.${s}`)}</option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta={t('oversize.escorts.providerNameLabel')}>
            <input type="text" value={form.data.provider_name} onChange={(e) => form.setData('provider_name', e.target.value)} className={CAMPO} />
          </Campo>
          <Campo etiqueta={t('oversize.escorts.contactPhoneLabel')}>
            <input type="text" value={form.data.contact_phone} onChange={(e) => form.setData('contact_phone', e.target.value)} className={CAMPO} />
          </Campo>
          <Campo etiqueta={t('oversize.escorts.scheduledForLabel')}>
            <input type="datetime-local" value={form.data.scheduled_for} onChange={(e) => form.setData('scheduled_for', e.target.value)} className={CAMPO} />
          </Campo>
          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {t('oversize.escorts.addButton')}
          </button>
        </form>
      ) : null}

      {escorts.length === 0 ? (
        <p className="mt-3 text-sm text-steel-600">{t('oversize.escorts.empty')}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {escorts.map((e) => (
            <li key={e.id} className="rounded border border-steel-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-carbon">{t(`oversize.escorts.type.${e.type}`)}</span>
                <Marca tono={e.status === 'confirmed' || e.status === 'completed' ? 'success' : 'steel'}>
                  {t(`oversize.escorts.status.${e.status}`)}
                </Marca>
                {e.state ? <span className="text-xs text-steel-700">{e.state}</span> : null}
              </div>
              <p className="mt-0.5 text-xs text-steel-600">
                {[e.provider, e.contactName, e.contactPhone, e.scheduledFor].filter(Boolean).join(' · ') || '—'}
              </p>
              {e.notes ? <p className="mt-1 text-sm text-carbon">{e.notes}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-40 flex-col gap-1">
      <span className="text-xs font-medium text-steel-700">{etiqueta}</span>
      {children}
    </label>
  )
}

const CAMPO =
  'rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'
