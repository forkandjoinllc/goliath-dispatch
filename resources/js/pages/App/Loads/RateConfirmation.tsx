import { Link, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Decision {
  id: string
  decision: string
  reason: string | null
  decidedAt: string
  actor: string
  amountCents: number | null
  ip: string | null
  onCurrentDocument: boolean
}

interface Props {
  load: {
    id: string
    number: string
    status: string | null
    carrierName: string | null
    rateCents: number | null
  }
  confirmation: { documentId: string; sha256: string; issuedAt: string } | null
  decisions: Decision[]
  currentDecisionStands: boolean
  can: { issue: boolean; respond: boolean; download: boolean }
}

/**
 * La confirmación de tarifa, vista desde las dos sillas.
 *
 * Despacho ve «¿aceptó?» y el transportista ve «¿qué me piden y por cuánto?».
 * Es la misma pregunta y por eso es la misma pantalla; lo que cambia lo deciden
 * los permisos.
 *
 * El caso que merece cuidado: despacho reemite con otra tarifa DESPUÉS de que
 * el transportista aceptara. La respuesta anterior sigue siendo cierta —aceptó
 * aquel papel— pero ya no vale para este, y dejar una marca verde de «aceptado»
 * encima sería la peor forma de contarlo. Se dice explícitamente.
 */
export default function RateConfirmationPage({
  load, confirmation, decisions, currentDecisionStands, can,
}: Props) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t('loads.rateConfirmation.title')}
      heading={load.number}
      description={t('loads.rateConfirmation.description')}
      crumbs={[
        { label: t('loads.index.title'), href: '/loads' },
        { label: load.number, href: `/loads/${load.id}` },
        { label: t('loads.rateConfirmation.title') },
      ]}
    >
      <div className="flex flex-col gap-4">
        <section className="rounded border border-steel-200 bg-white p-4">
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <Dato etiqueta={t('loads.detail.carrier')} valor={load.carrierName ?? '—'} />
            <Dato etiqueta={t('loads.rateConfirmation.amount')} valor={dinero(load.rateCents)} />
          </dl>

          {confirmation === null ? (
            <p className="mt-3 rounded border border-dashed border-steel-300 p-3 text-sm text-steel-700">
              {t('loads.rateConfirmation.noneIssued')}
            </p>
          ) : (
            <div className="mt-3 border-t border-steel-100 pt-3">
              <p className="text-sm text-carbon">
                {t('loads.rateConfirmation.issuedAt', { date: confirmation.issuedAt })}
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <span className="text-xs text-steel-600">{t('loads.rateConfirmation.fingerprint')}</span>
                <span className="break-all font-mono text-[11px] text-carbon">{confirmation.sha256}</span>
              </div>
              {can.download ? (
                <a
                  href={`/documents/${confirmation.documentId}/download`}
                  className="mt-2 inline-block text-sm font-medium text-navy-700 hover:underline"
                >
                  {t('loads.rateConfirmation.download')}
                </a>
              ) : null}
            </div>
          )}

          {can.issue ? <Emitir loadId={load.id} yaHay={confirmation !== null} /> : null}
        </section>

        {decisions.length > 0 && ! currentDecisionStands && confirmation !== null ? (
          <p className="rounded border border-warning-300 bg-warning-50 p-3 text-sm text-carbon">
            {t('loads.rateConfirmation.stale')}
          </p>
        ) : null}

        {can.respond && confirmation !== null ? (
          <Responder loadId={load.id} />
        ) : null}

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('loads.rateConfirmation.historyTitle')}</p>

          {decisions.length === 0 ? (
            <p className="mt-2 text-sm text-steel-600">{t('loads.rateConfirmation.historyEmpty')}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {decisions.map((d) => (
                <li key={d.id} className="border-l-2 border-steel-200 pl-3">
                  <p className="text-sm text-carbon">
                    <Marca decision={d.decision} />
                    <span className="ml-2 text-steel-700">
                      {t('loads.rateConfirmation.decidedBy', { actor: d.actor, date: d.decidedAt })}
                    </span>
                  </p>
                  <p className="text-xs text-steel-600">
                    {dinero(d.amountCents)}
                    {d.ip ? ` · ${d.ip}` : ''}
                    {! d.onCurrentDocument ? ` · ${t('loads.rateConfirmation.onOlderDocument')}` : ''}
                  </p>
                  {d.reason ? <p className="mt-1 text-sm text-carbon">{d.reason}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-steel-600">{t('loads.rateConfirmation.legalNotice')}</p>

        <Link href={`/loads/${load.id}`} className="text-sm font-medium text-navy-700 hover:underline">
          {load.number}
        </Link>
      </div>
    </AppLayout>
  )
}

function Marca({ decision }: { decision: string }) {
  const { t } = useI18n()

  const tono: Record<string, string> = {
    accepted: 'bg-success-50 text-success-700',
    rejected: 'bg-danger-50 text-danger-700',
    changes_requested: 'bg-warning-50 text-warning-700',
  }

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tono[decision] ?? 'bg-steel-100 text-steel-700'}`}>
      {t(`loads.rateConfirmation.decisions.${decision}`)}
    </span>
  )
}

function Emitir({ loadId, yaHay }: { loadId: string; yaHay: boolean }) {
  const { t } = useI18n()
  const form = useForm({})

  return (
    <button
      type="button"
      disabled={form.processing}
      onClick={() => form.post(`/loads/${loadId}/rate-confirmation`, { preserveScroll: true })}
      className="mt-3 rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
    >
      {yaHay ? t('loads.rateConfirmation.reissue') : t('loads.rateConfirmation.issue')}
    </button>
  )
}

function Responder({ loadId }: { loadId: string }) {
  const { t } = useI18n()
  const [eleccion, setEleccion] = useState<string | null>(null)
  const form = useForm({ decision: '', reason: '' })

  const necesitaMotivo = eleccion !== null && eleccion !== 'accepted'

  const enviar = (decision: string) => {
    form.transform((d) => ({ ...d, decision }))
    form.post(`/loads/${loadId}/rate-confirmation/decide`, {
      preserveScroll: true,
      onSuccess: () => { form.reset(); setEleccion(null) },
    })
  }

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <p className="text-sm font-semibold text-carbon">{t('loads.rateConfirmation.respondTitle')}</p>
      <p className="mt-0.5 text-xs text-steel-600">{t('loads.rateConfirmation.respondHint')}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {['accepted', 'rejected', 'changes_requested'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setEleccion(d)}
            className={`rounded border px-4 py-2 text-sm transition ${
              eleccion === d
                ? 'border-navy-600 bg-navy-50 font-medium text-navy-800'
                : 'border-steel-300 bg-white text-steel-700 hover:bg-steel-50'
            }`}
          >
            {t(`loads.rateConfirmation.decisions.${d}Action`)}
          </button>
        ))}
      </div>

      {eleccion !== null ? (
        <form
          onSubmit={(e) => { e.preventDefault(); enviar(eleccion) }}
          className="mt-3 flex flex-col gap-2 border-t border-steel-100 pt-3"
        >
          {necesitaMotivo ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-steel-700">{t('loads.rateConfirmation.reasonLabel')}</span>
              <textarea
                rows={3}
                value={form.data.reason}
                onChange={(e) => form.setData('reason', e.target.value)}
                className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
              />
              <span className="text-[11px] text-steel-500">{t('loads.rateConfirmation.reasonRequired')}</span>
            </label>
          ) : null}

          <button
            type="submit"
            disabled={form.processing || (necesitaMotivo && form.data.reason.trim() === '')}
            className="self-start rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {t(`loads.rateConfirmation.decisions.${eleccion}Action`)}
          </button>
        </form>
      ) : null}
    </section>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-steel-600">{etiqueta}</dt>
      <dd className="break-words text-sm text-carbon">{valor}</dd>
    </div>
  )
}

function dinero(cents: number | null): string {
  if (cents === null) return '—'
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
