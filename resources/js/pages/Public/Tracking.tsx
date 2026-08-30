import { Head } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'

interface Stop {
  type: string
  city: string | null
  state: string | null
  windowStart: string | null
  windowEnd: string | null
  arrivedAt: string | null
  departedAt: string | null
}

interface Props {
  state: 'active' | 'not_found' | 'expired' | 'revoked' | 'disabled'
  load: {
    number: string
    status: string
    carrierName: string | null
    plannedDeliveryOn: string | null
  } | null
  stops: Stop[]
  lastUpdate: { at: string; location: string | null } | null
  tenantName: string | null
}

/**
 * Lo que ve el cliente final. Sin sesión, sin menú y sin nada del armazón.
 *
 * No usa `AppLayout` a propósito: ese layout da por hecho que hay una persona
 * con permisos dentro de una empresa. Aquí no hay ninguna de las tres cosas, y
 * pintar el menú de la aplicación a un desconocido sería enseñarle el mapa de
 * algo a lo que no puede entrar.
 *
 * Un enlace muerto se cuenta por su motivo: mal copiado, vencido o revocado
 * mandan a la persona a sitios distintos. Los tres devuelven 404 igual; lo que
 * cambia es el texto.
 */
export default function PublicTracking({ state, load, stops, lastUpdate, tenantName }: Props) {
  const { t } = useI18n()

  if (state !== 'active' || load === null) {
    const clave = state === 'expired' ? 'expired' : state === 'revoked' ? 'revoked' : 'notFound'

    return (
      <Marco titulo={t('tracking.publicPage.title')}>
        <h1 className="font-display text-2xl font-bold text-carbon">
          {t(`tracking.publicPage.${clave}Title`)}
        </h1>
        <p className="mt-2 text-sm text-steel-700">{t(`tracking.publicPage.${clave}Body`)}</p>
      </Marco>
    )
  }

  return (
    <Marco titulo={`${t('tracking.publicPage.title')} — ${load.number}`}>
      <p className="text-xs uppercase tracking-wide text-steel-600">
        {t('tracking.publicPage.loadLabel', { loadNumber: load.number })}
      </p>
      <h1 className="mt-1 font-display text-2xl font-bold text-carbon">
        {t(`tracking.status.${load.status}`)}
      </h1>

      {load.carrierName ? (
        <p className="mt-1 text-sm text-steel-700">
          {t('tracking.publicPage.carrierLabel', { carrier: load.carrierName })}
        </p>
      ) : null}

      <div className="mt-5 rounded border border-steel-200 p-4">
        <p className="text-xs uppercase tracking-wide text-steel-600">
          {t('tracking.publicPage.lastUpdated', { date: lastUpdate?.at ?? '' })}
        </p>
        <p className="mt-1 text-sm text-carbon">
          {lastUpdate === null
            ? t('tracking.publicPage.noUpdatesYet')
            : (lastUpdate.location ?? t('tracking.publicPage.noUpdatesYet'))}
        </p>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-carbon">{t('tracking.publicPage.stopsTitle')}</h2>
      <ol className="mt-2 flex flex-col gap-3">
        {stops.map((s, i) => (
          <li key={i} className="border-l-2 border-steel-200 pl-3">
            <p className="text-sm font-medium text-carbon">
              {t(`tracking.stops.${s.type === 'pickup' ? 'pickup' : 'delivery'}`)}
              {' · '}
              {[s.city, s.state].filter(Boolean).join(', ')}
            </p>
            {s.windowStart ? (
              <p className="text-xs text-steel-600">
                {t('tracking.publicPage.stopWindow', { start: s.windowStart, end: s.windowEnd ?? '' })}
              </p>
            ) : null}
            <p className="text-xs text-steel-700">
              {s.arrivedAt
                ? t('tracking.publicPage.stopArrived', { date: s.arrivedAt })
                : t('tracking.publicPage.stopPending')}
              {s.departedAt
                ? ` · ${t('tracking.publicPage.stopDeparted', { date: s.departedAt })}`
                : ''}
            </p>
          </li>
        ))}
      </ol>

      {tenantName ? (
        <p className="mt-8 border-t border-steel-200 pt-4 text-xs text-steel-600">
          {t('tracking.publicPage.poweredBy', { tenant: tenantName })}
        </p>
      ) : null}
    </Marco>
  )
}

function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <>
      <Head title={titulo}>
        {/* Una página con un token en la dirección no se indexa. */}
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <main className="min-h-screen bg-steel-50 px-4 py-10">
        <div className="mx-auto max-w-2xl rounded border border-steel-200 bg-white p-6 sm:p-8">
          {children}
        </div>
      </main>
    </>
  )
}
