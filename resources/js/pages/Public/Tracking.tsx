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
  lastUpdate: { at: string; location: string | null; reportedByPerson: boolean } | null
  /**
   * Lo que ha pasado, en orden. Menos que el panel de despacho: sin
   * coordenadas y sin los sucesos del consentimiento del conductor, que son
   * asunto entre él y su empresa y no de quien compró un flete.
   */
  timeline: {
    id: string
    type: string
    reportedByPerson: boolean
    location: string | null
    at: string
  }[]
  progress: { done: number; total: number } | null
  tenantName: string | null
  /**
   * La cara de la empresa. Nula en un enlace roto: decir de quién era
   * convertiría probar tokens al azar en una forma de averiguar qué empresas
   * usan esto.
   */
  brand: {
    name: string
    logoUrl: string | null
    primaryColor: string
    accentColor: string
  } | null
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
export default function PublicTracking({
  state, load, stops, lastUpdate, timeline, progress, tenantName, brand,
}: Props) {
  const { t } = useI18n()

  if (state !== 'active' || load === null) {
    const clave = state === 'expired' ? 'expired' : state === 'revoked' ? 'revoked' : 'notFound'

    return (
      <Marco titulo={t('tracking.publicPage.title')} brand={brand}>
        <h1 className="font-display text-2xl font-bold text-carbon">
          {t(`tracking.publicPage.${clave}Title`)}
        </h1>
        <p className="mt-2 text-sm text-steel-700">{t(`tracking.publicPage.${clave}Body`)}</p>
      </Marco>
    )
  }

  return (
    <Marco titulo={`${t('tracking.publicPage.title')} — ${load.number}`} brand={brand}>
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
        {/* De dónde salió el dato. Un cliente que lee «Laredo, TX» merece saber
            si lo dijo un aparato del camión o una persona que llamó por
            teléfono: las dos cosas son ciertas y no valen lo mismo. */}
        {lastUpdate !== null ? (
          <p className="mt-1 text-xs text-steel-600">
            {lastUpdate.reportedByPerson
              ? t('tracking.publicPage.reportedByPerson')
              : t('tracking.publicPage.reportedByProvider')}
          </p>
        ) : null}
        {progress !== null && progress.total > 0 ? (
          <p className="mt-2 text-xs text-steel-700">
            {t('tracking.publicPage.progressLabel', { done: progress.done, total: progress.total })}
          </p>
        ) : null}
      </div>

      <h2 className="mt-6 text-sm font-semibold text-carbon">{t('tracking.publicPage.stopsTitle')}</h2>
      <ol className="mt-2 flex flex-col gap-3">
        {/* El color de acento se USA, no solo se guarda. Una empresa que elige
            dos colores y solo ve uno tiene medio ajuste inerte, que es el
            defecto que el lote 55 existió para quitar. */}
        {stops.map((s, i) => (
          <li
            key={i}
            className="border-l-2 border-steel-200 pl-3"
            style={brand ? { borderColor: brand.accentColor } : undefined}
          >
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

      {timeline.length > 0 ? (
        <>
          <h2 className="mt-6 text-sm font-semibold text-carbon">
            {t('tracking.publicPage.timelineTitle')}
          </h2>
          <ol className="mt-2 flex flex-col gap-2">
            {timeline.map((e) => (
              <li key={e.id} className="border-l-2 border-steel-200 pl-3" style={brand ? { borderColor: brand.accentColor } : undefined}>
                <p className="text-sm text-carbon">
                  {t(`tracking.event.${e.type}`)}
                  {e.location ? ` · ${e.location}` : ''}
                </p>
                <p className="text-xs text-steel-600">{e.at}</p>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {tenantName ? (
        <p className="mt-8 border-t border-steel-200 pt-4 text-xs text-steel-600">
          {t('tracking.publicPage.poweredBy', { tenant: tenantName })}
        </p>
      ) : null}
    </Marco>
  )
}

function Marco({
  titulo, brand, children,
}: {
  titulo: string
  brand?: Props['brand']
  children: React.ReactNode
}) {
  return (
    <>
      <Head title={titulo}>
        {/* Una página con un token en la dirección no se indexa. */}
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {/* Los colores entran como VARIABLES, no como una hoja de estilos de la
          empresa: un color mal puesto puede dejar un texto feo, pero no puede
          ejecutar nada. Ver App\Support\Branding\Brand. */}
      <main
        className="min-h-screen bg-steel-50 px-4 py-10"
        style={brand ? ({ '--marca': brand.primaryColor, '--acento': brand.accentColor } as React.CSSProperties) : undefined}
      >
        <div className="mx-auto max-w-2xl overflow-hidden rounded border border-steel-200 bg-white">
          <div
            className="h-2 w-full"
            style={{ backgroundColor: brand ? 'var(--marca)' : undefined }}
          />
          <div className="p-6 sm:p-8">
          {brand?.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={brand.name}
              className="mb-6 h-10 w-auto"
            />
          ) : null}
          {children}
          </div>
        </div>
      </main>
    </>
  )
}
