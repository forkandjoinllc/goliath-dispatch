import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Tarea {
  task: string
  hasEverRun: boolean
  status: string | null
  startedAt: string | null
  completedAt: string | null
  durationSeconds: number | null
  summary: Record<string, number>
  lastError: string | null
  runCount: number
}

interface Proveedor {
  key: string
  interface: string
  bound: string
  status: 'live' | 'mock' | 'fallback'
  detail: string | null
  envVar: boolean
}

interface Props {
  scheduler: { tasks: Tarea[]; cronLine: string }
  providers: Proveedor[]
  jobs: {
    queued: number
    running: number
    failed: number
    deadLetter: number
    oldestQueuedAt: string | null
  }
  expirations: { warning: number; expired: number; oldestFirstDetectedAt: string | null }
  database: { name: string; version: string }
  tenants: Record<string, number>
}

/**
 * La salud de la instalación.
 *
 * Lo primero y más grande es el planificador, y no por orden alfabético: un
 * cron muerto no da ningún error, da el mismo SILENCIO que un día tranquilo.
 * Una tarea que no ha corrido nunca sale con un bloque rojo y la línea de cron
 * lista para copiar, porque quien abre esta pantalla no quiere enterarse del
 * problema: quiere arreglarlo.
 */
export default function PlatformHealth({
  scheduler, providers, jobs, expirations, database, tenants,
}: Props) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t('platform.health.title')}
      description={t('platform.health.description')}
      crumbs={[{ label: t('platform.health.title') }]}
    >
      <div className="flex flex-col gap-4">
        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('platform.health.schedulerTitle')}</p>
          <p className="mt-0.5 text-xs text-steel-600">{t('platform.health.schedulerDescription')}</p>

          <ul className="mt-3 flex flex-col gap-3">
            {scheduler.tasks.map((tarea) => (
              <li key={tarea.task}>
                {tarea.hasEverRun ? (
                  <Corrio tarea={tarea} />
                ) : (
                  <NuncaCorrio tarea={tarea} cronLine={scheduler.cronLine} />
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('platform.health.providersTitle')}</p>
          <p className="mt-0.5 text-xs text-steel-600">{t('platform.health.providersDescription')}</p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-steel-100">
                {providers.map((p) => (
                  <tr key={p.key}>
                    <td className="py-2 pr-4 font-mono text-xs text-steel-700">{p.interface}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                          p.status === 'live'
                            ? 'bg-success-50 text-success-700'
                            : p.status === 'fallback'
                              ? 'bg-steel-100 text-steel-700'
                              : 'bg-warning-50 text-warning-700'
                        }`}
                      >
                        {t(
                          p.status === 'live'
                            ? 'platform.health.providerLive'
                            : p.status === 'fallback'
                              ? 'platform.health.providerFallback'
                              : 'platform.health.providerMock',
                        )}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-carbon">{p.bound}</td>
                    <td className="py-2 text-xs text-steel-600">
                      {/* «Falta X» solo cuando X ES una variable de entorno.
                          Antes se escribía «Falta storage/logs», que es decir
                          que falta un directorio que está ahí. */}
                      {p.detail === null
                        ? ''
                        : p.envVar
                          ? t('platform.health.providerMissingEnv', { env: p.detail })
                          : p.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded border border-steel-200 bg-white p-4">
            <p className="text-sm font-semibold text-carbon">{t('platform.health.expirationsTitle')}</p>
            <p className="mt-0.5 text-xs text-steel-600">{t('platform.health.expirationsDescription')}</p>

            {expirations.warning === 0 && expirations.expired === 0 ? (
              <p className="mt-3 text-sm text-steel-600">{t('platform.health.expirationsEmpty')}</p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-4">
                  <Cifra etiqueta={t('platform.health.expirationsWarning')} valor={expirations.warning} />
                  <Cifra
                    etiqueta={t('platform.health.expirationsExpired')}
                    valor={expirations.expired}
                    alerta={expirations.expired > 0}
                  />
                </div>
                {expirations.oldestFirstDetectedAt !== null ? (
                  <p className="mt-2 text-xs text-steel-600">
                    {t('platform.health.expirationsOldest', { date: expirations.oldestFirstDetectedAt })}
                  </p>
                ) : null}
              </>
            )}
          </section>

          <section className="rounded border border-steel-200 bg-white p-4">
            <p className="text-sm font-semibold text-carbon">{t('platform.health.jobQueueTitle')}</p>
            <div className="mt-3 flex flex-wrap gap-4">
              <Cifra etiqueta={t('platform.health.queued')} valor={jobs.queued} />
              <Cifra etiqueta={t('platform.health.running')} valor={jobs.running} />
              <Cifra etiqueta={t('platform.health.failed')} valor={jobs.failed} alerta={jobs.failed > 0} />
              <Cifra
                etiqueta={t('platform.health.deadLetter')}
                valor={jobs.deadLetter}
                alerta={jobs.deadLetter > 0}
              />
            </div>
            <p className="mt-2 text-xs text-steel-600">
              {t('platform.health.oldestQueued')}: {jobs.oldestQueuedAt ?? t('platform.health.none')}
            </p>
          </section>

          <section className="rounded border border-steel-200 bg-white p-4">
            <p className="text-sm font-semibold text-carbon">{t('platform.health.tenantsByStatus')}</p>
            <div className="mt-3 flex flex-wrap gap-4">
              {Object.entries(tenants).map(([estado, total]) => (
                <Cifra key={estado} etiqueta={estado} valor={total} />
              ))}
            </div>
          </section>

          <section className="rounded border border-steel-200 bg-white p-4">
            <p className="text-sm font-semibold text-carbon">{t('platform.health.databaseTitle')}</p>
            <dl className="mt-3 flex flex-col gap-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-steel-600">{t('platform.health.databaseName')}</dt>
                <dd className="font-mono text-xs text-carbon">{database.name}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-steel-600">{t('platform.health.databaseVersion')}</dt>
                <dd className="font-mono text-xs text-carbon">{database.version}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </AppLayout>
  )
}

function NuncaCorrio({ tarea, cronLine }: { tarea: Tarea; cronLine: string }) {
  const { t } = useI18n()

  return (
    <div className="rounded border border-danger-300 bg-danger-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-carbon">{tarea.task}</span>
        <span className="rounded bg-danger-600 px-2 py-0.5 text-xs font-semibold text-white">
          {t('platform.health.neverRan')}
        </span>
      </div>
      <p className="mt-2 text-sm text-carbon">{t('platform.health.neverRanExplanation')}</p>
      <p className="mt-3 text-xs text-carbon">{t('platform.health.cronLine')}</p>
      <pre className="mt-1 overflow-x-auto rounded bg-white px-3 py-2 font-mono text-[11px] text-carbon">
        {cronLine}
      </pre>
    </div>
  )
}

function Corrio({ tarea }: { tarea: Tarea }) {
  const { t } = useI18n()
  const fallo = tarea.status === 'failed'

  return (
    <div className={`rounded border p-4 ${fallo ? 'border-danger-300 bg-danger-50' : 'border-steel-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-carbon">{tarea.task}</span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            fallo
              ? 'bg-danger-50 text-danger-700'
              : tarea.status === 'running'
                ? 'bg-navy-50 text-navy-700'
                : 'bg-success-50 text-success-700'
          }`}
        >
          {t(`platform.health.runStatus.${tarea.status ?? 'running'}`)}
        </span>
      </div>

      <p className="mt-1 text-xs text-steel-600">
        {t('platform.health.lastRun')}: {tarea.startedAt ?? '—'}
        {tarea.durationSeconds !== null
          ? ` · ${t('platform.health.duration', { seconds: String(tarea.durationSeconds) })}`
          : ''}
        {' · '}
        {t(tarea.runCount === 1 ? 'platform.health.runCountOne' : 'platform.health.runCount', {
          n: String(tarea.runCount),
        })}
      </p>

      {Object.keys(tarea.summary).length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-3">
          {Object.entries(tarea.summary).map(([clave, valor]) => (
            <span key={clave} className="rounded border border-steel-300 px-2 py-1 text-xs text-carbon">
              {clave}: <strong>{valor}</strong>
            </span>
          ))}
        </div>
      ) : null}

      {tarea.lastError !== null ? (
        <p className="mt-2 rounded bg-white px-3 py-2 font-mono text-[11px] text-danger-800">
          {tarea.lastError}
        </p>
      ) : null}
    </div>
  )
}

function Cifra({ etiqueta, valor, alerta = false }: { etiqueta: string; valor: number; alerta?: boolean }) {
  return (
    <div>
      <p className={`text-2xl font-semibold ${alerta ? 'text-danger-700' : 'text-carbon'}`}>{valor}</p>
      <p className="text-xs text-steel-600">{etiqueta}</p>
    </div>
  )
}
