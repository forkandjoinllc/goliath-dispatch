import { useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Hold {
  id: string
  name: string
  reason: string
  scopeType: string
  entityType: string | null
  entityId: string | null
  matterReference: string | null
  appliedAt: string
  appliedBy: string
}

interface Entity {
  key: string
  class: string
  purgeable: boolean
}

interface Props {
  policy: {
    operationalActiveMonths: number
    operationalPurgeYears: number
    financialRetentionYears: number
    purgeEnabled: boolean
  }
  holds: Hold[]
  wouldPurge: { entity: string; candidates: number; skipped: number }[]
  runs: {
    id: string
    action: string
    entity: string
    status: string
    candidates: number
    processed: number
    skipped: number
    at: string
  }[]
  entities: Entity[]
  storage: {
    orphans: number
    orphanBytes: number
    scanned: number
    tooRecent: number
    dangling: number
    graceHours: number
  }
  lastSweep: { hasEverRun: boolean; startedAt: string | null; status: string | null } | null
  scopes: string[]
  can: { hold: boolean }
}

/**
 * Retención y bloqueos.
 *
 * El orden de la pantalla es una opinión. Arriba, la política y si la purga
 * permanente está encendida en este servidor — porque eso cambia por completo
 * lo que significa la lista de más abajo: apagada es una previsión, encendida es
 * lo que va a pasar el domingo.
 *
 * Después los bloqueos, que es lo que alguien viene a hacer aquí un martes:
 * llega una reclamación por una carga y hay que decir «esto no se toca» antes de
 * que la política haga su trabajo y borre la prueba.
 *
 * No hay botón de purgar. Purgar es un DELETE que no se deshace, y un botón así
 * es un botón que alguien pulsa por curiosidad un viernes.
 */
export default function RetentionPage({ policy, holds, wouldPurge, runs, entities, storage, lastSweep, scopes, can }: Props) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t('retention.index.title')}
      heading={t('retention.index.title')}
      description={t('retention.index.description')}
      crumbs={[{ label: t('retention.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('retention.index.policyTitle')}</p>
          <p className="mt-1 text-sm text-carbon">
            {t('retention.index.policyLine', {
              months: policy.operationalActiveMonths,
              purge: policy.operationalPurgeYears,
              financial: policy.financialRetentionYears,
            })}
          </p>
          <p className="mt-2 text-xs text-steel-600">{t('retention.index.policyNote')}</p>
        </section>

        {/*
          Encendida o apagada, se dice arriba y con el color que le toca. Una
          purga permanente activa sin avisar es la peor sorpresa que este módulo
          puede dar.
        */}
        <section
          className={`rounded border p-3 ${
            policy.purgeEnabled
              ? 'border-danger-300 bg-danger-50'
              : 'border-steel-200 bg-steel-50'
          }`}
        >
          <p className={`text-sm font-semibold ${policy.purgeEnabled ? 'text-danger-800' : 'text-carbon'}`}>
            {policy.purgeEnabled ? t('retention.index.purgeOn') : t('retention.index.purgeOff')}
          </p>
          <p className="mt-0.5 text-sm text-carbon">
            {policy.purgeEnabled ? t('retention.index.purgeOnHint') : t('retention.index.purgeOffHint')}
          </p>
        </section>

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('retention.holds.title')}</p>

          {holds.length === 0 ? (
            <p className="mt-2 text-sm text-steel-600">{t('retention.holds.empty')}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-4">
              {holds.map((h) => (
                <Bloqueo key={h.id} hold={h} entities={entities} puede={can.hold} />
              ))}
            </ul>
          )}
        </section>

        {can.hold ? <NuevoBloqueo entities={entities} scopes={scopes} /> : null}

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('retention.purge.title')}</p>
          <p className="mt-0.5 text-xs text-steel-600">{t('retention.purge.hint')}</p>

          {wouldPurge.length === 0 ? (
            <p className="mt-2 text-sm text-steel-600">{t('retention.purge.empty')}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-steel-200 text-left text-xs uppercase tracking-wide text-steel-600">
                    <th className="py-2 pr-4">{t('retention.purge.entity')}</th>
                    <th className="py-2 pr-4 text-right">{t('retention.purge.candidates')}</th>
                    <th className="py-2 text-right">{t('retention.purge.skipped')}</th>
                  </tr>
                </thead>
                <tbody>
                  {wouldPurge.map((f) => (
                    <tr key={f.entity} className="border-b border-steel-100">
                      <td className="py-2 pr-4 font-mono text-xs text-carbon">{f.entity}</td>
                      <td className="py-2 pr-4 text-right text-carbon">{f.candidates}</td>
                      <td className="py-2 text-right text-steel-700">{f.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/*
          El almacén, junto a la retención y no en su propia pantalla: es la
          misma pregunta por el otro lado. La política dice cuánto se conservan
          los registros; esto dice si los ficheros de esos registros están donde
          deberían. Hasta el lote 53 no había forma de saberlo.
        */}
        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('retention.storage.title')}</p>
          <p className="mt-0.5 text-xs text-steel-600">{t('retention.storage.hint')}</p>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-carbon">{t('retention.storage.orphans')}</p>
              {storage.orphans === 0 ? (
                <p className="mt-1 text-sm text-success-700">{t('retention.storage.orphansZero')}</p>
              ) : (
                <p className="mt-1 text-2xl font-semibold text-carbon">
                  {storage.orphans}
                  {/*
                    El separador es un carácter de VERDAD, no un margen de CSS.
                    Con solo `ml-2`, la cifra y el tamaño quedan pegados en el
                    texto plano —«1» y «16 B» se leen «116 B»— y eso es lo que
                    oye quien usa un lector de pantalla, que no ve márgenes.
                  */}
                  <span className="ml-2 text-sm font-normal text-steel-600">· {peso(storage.orphanBytes)}</span>
                </p>
              )}
              <p className="mt-1 text-xs text-steel-600">
                {t('retention.storage.orphansHint', { hours: storage.graceHours })}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-carbon">{t('retention.storage.dangling')}</p>
              {storage.dangling === 0 ? (
                <p className="mt-1 text-sm text-success-700">{t('retention.storage.danglingZero')}</p>
              ) : (
                <p className="mt-1 text-2xl font-semibold text-danger-700">{storage.dangling}</p>
              )}
              <p className="mt-1 text-xs text-steel-600">{t('retention.storage.danglingHint')}</p>
            </div>
          </div>

          <p className="mt-3 text-xs text-steel-600">
            {t('retention.storage.scanned')}: {storage.scanned}
            {storage.tooRecent > 0 ? ` · ${t('retention.storage.tooRecent')}: ${storage.tooRecent}` : ''}
          </p>
          <p className="mt-1 text-xs text-steel-600">{t('retention.storage.purgeNote')}</p>
        </section>

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('retention.runs.title')}</p>

          {runs.length === 0 ? (
            <>
              {/*
                «No ha corrido» y «corrió y no había nada que hacer» son cosas
                distintas y la pantalla decía la primera para las dos. Un
                barrido sin trabajo no escribe filas —no hay nada que contar—,
                y para una empresa nueva ese es el estado normal durante dos
                años: dos años diciéndole que su retención no funciona.
              */}
              {lastSweep !== null && lastSweep.hasEverRun ? (
                <p className="mt-2 text-sm text-steel-700">
                  {t('retention.runs.ranWithNothingToDo', { date: lastSweep.startedAt ?? '' })}
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-steel-600">{t('retention.runs.empty')}</p>
                  <p className="mt-0.5 text-xs text-steel-600">{t('retention.runs.emptyHint')}</p>
                </>
              )}
            </>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-steel-200 text-left text-xs uppercase tracking-wide text-steel-600">
                    <th className="py-2 pr-4">{t('retention.runs.at')}</th>
                    <th className="py-2 pr-4">{t('retention.runs.action')}</th>
                    <th className="py-2 pr-4">{t('retention.purge.entity')}</th>
                    <th className="py-2 pr-4 text-right">{t('retention.runs.candidates')}</th>
                    <th className="py-2 pr-4 text-right">{t('retention.runs.processed')}</th>
                    <th className="py-2 text-right">{t('retention.runs.skipped')}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-steel-100">
                      <td className="py-2 pr-4 text-steel-700">{r.at}</td>
                      <td className="py-2 pr-4 text-carbon">
                        {r.action === 'purge' ? t('retention.runs.purgeAction') : t('retention.runs.archive')}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-carbon">{r.entity}</td>
                      <td className="py-2 pr-4 text-right text-steel-700">{r.candidates}</td>
                      <td className="py-2 pr-4 text-right text-carbon">{r.processed}</td>
                      <td className="py-2 text-right text-steel-700">{r.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  )
}

function Bloqueo({ hold, entities, puede }: { hold: Hold; entities: Entity[]; puede: boolean }) {
  const { t } = useI18n()
  const [levantando, setLevantando] = useState(false)
  const form = useForm({ release_reason: '' })

  const tipo = entities.find((e) => e.key === hold.entityType)

  return (
    <li className="border-l-2 border-warning-500 pl-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-carbon">{hold.name}</p>
        <span className="text-xs text-steel-600">
          {t('retention.holds.appliedBy', { who: hold.appliedBy, date: hold.appliedAt })}
        </span>
      </div>

      <p className="mt-0.5 text-xs text-steel-600">
        {t(`retention.scope.${hold.scopeType}`)}
        {hold.entityType !== null ? ` · ${hold.entityType}` : ''}
        {hold.entityId !== null ? ` · ${hold.entityId}` : ''}
        {hold.matterReference !== null ? ` · ${hold.matterReference}` : ''}
        {/*
          Decirlo evita que alguien crea que hizo algo: bloquear un registro que
          nunca se purga no impide una purga que nunca iba a ocurrir.
        */}
        {tipo !== undefined && !tipo.purgeable ? ` · ${t('retention.holds.cannotPurge')}` : ''}
      </p>

      <p className="mt-1 whitespace-pre-wrap text-sm text-carbon">{hold.reason}</p>

      {puede ? (
        <>
          <button
            type="button"
            onClick={() => setLevantando((v) => !v)}
            className="mt-1 text-sm font-medium text-danger-700 hover:underline"
          >
            {t('retention.holds.release')}
          </button>

          {levantando ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                form.post(`/retention/holds/${hold.id}/release`, { preserveScroll: true })
              }}
              className="mt-2 flex flex-col gap-2 rounded border border-steel-200 bg-steel-50 p-3"
            >
              <p className="text-sm font-semibold text-carbon">{t('retention.holds.releaseTitle')}</p>
              <p className="text-xs text-steel-700">{t('retention.holds.releaseHint')}</p>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-steel-700">
                  {t('retention.holds.releaseReasonLabel')}
                </span>
                <textarea
                  rows={3}
                  value={form.data.release_reason}
                  onChange={(e) => form.setData('release_reason', e.target.value)}
                  className="rounded border border-steel-300 px-3 py-2 text-sm"
                />
              </label>
              {form.errors.release_reason ? (
                <p role="alert" className="text-sm text-danger-700">{form.errors.release_reason}</p>
              ) : null}

              <button
                type="submit"
                disabled={form.processing}
                className="self-start rounded bg-danger-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-danger-800 disabled:opacity-50"
              >
                {t('retention.holds.confirmRelease')}
              </button>
            </form>
          ) : null}
        </>
      ) : null}
    </li>
  )
}

function NuevoBloqueo({ entities, scopes }: { entities: Entity[]; scopes: string[] }) {
  const { t } = useI18n()
  const form = useForm({
    name: '',
    reason: '',
    scope_type: 'tenant',
    entity_type: '',
    entity_id: '',
    matter_reference: '',
  })

  const necesitaTipo = form.data.scope_type !== 'tenant'
  const necesitaId = form.data.scope_type === 'record'

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.post('/retention/holds', { preserveScroll: true, onSuccess: () => form.reset() })
      }}
      className="rounded border border-steel-200 bg-white p-4"
    >
      <p className="text-sm font-semibold text-carbon">{t('retention.holds.newTitle')}</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-steel-700">{t('retention.holds.nameLabel')}</span>
          <input
            type="text"
            value={form.data.name}
            placeholder={t('retention.holds.namePlaceholder')}
            onChange={(e) => form.setData('name', e.target.value)}
            className="rounded border border-steel-300 px-3 py-2 text-sm"
          />
          {form.errors.name ? (
            <span role="alert" className="text-sm text-danger-700">{form.errors.name}</span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-steel-700">{t('retention.holds.matterLabel')}</span>
          <input
            type="text"
            value={form.data.matter_reference}
            onChange={(e) => form.setData('matter_reference', e.target.value)}
            className="rounded border border-steel-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-steel-700">{t('retention.holds.scopeLabel')}</span>
          <select
            value={form.data.scope_type}
            onChange={(e) => form.setData('scope_type', e.target.value)}
            className="rounded border border-steel-300 px-3 py-2 text-sm"
          >
            {scopes.map((s) => (
              <option key={s} value={s}>{t(`retention.scope.${s}`)}</option>
            ))}
          </select>
        </label>

        {necesitaTipo ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('retention.holds.entityLabel')}</span>
            <select
              value={form.data.entity_type}
              onChange={(e) => form.setData('entity_type', e.target.value)}
              className="rounded border border-steel-300 px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {entities.map((en) => (
                <option key={en.key} value={en.key}>
                  {en.key} · {t(`retention.entityClass.${en.class}`)}
                  {en.purgeable ? '' : ` · ${t('retention.holds.cannotPurge')}`}
                </option>
              ))}
            </select>
            {form.errors.entity_type ? (
              <span role="alert" className="text-sm text-danger-700">{form.errors.entity_type}</span>
            ) : null}
          </label>
        ) : null}

        {necesitaId ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('retention.holds.entityIdLabel')}</span>
            <input
              type="text"
              value={form.data.entity_id}
              onChange={(e) => form.setData('entity_id', e.target.value)}
              className="rounded border border-steel-300 px-3 py-2 font-mono text-xs"
            />
            {form.errors.entity_id ? (
              <span role="alert" className="text-sm text-danger-700">{form.errors.entity_id}</span>
            ) : null}
          </label>
        ) : null}
      </div>

      <label className="mt-4 flex flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('retention.holds.reasonLabel')}</span>
        <textarea
          rows={3}
          value={form.data.reason}
          onChange={(e) => form.setData('reason', e.target.value)}
          className="rounded border border-steel-300 px-3 py-2 text-sm"
        />
        <span className="text-xs text-steel-600">{t('retention.holds.reasonHint')}</span>
      </label>
      {form.errors.reason ? (
        <p role="alert" className="mt-1 text-sm text-danger-700">{form.errors.reason}</p>
      ) : null}

      <button
        type="submit"
        disabled={form.processing}
        className="mt-4 rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
      >
        {t('retention.holds.apply')}
      </button>
    </form>
  )
}

function peso(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
