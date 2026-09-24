import { Link } from '@inertiajs/react'
import { Avatar } from '@/components/App/Board/Avatar'
import { DriverStatusBadge } from '@/components/App/DriverStatus'
import { StatusBadge } from '@/components/App/StatusBadge'
import { Timeline, type Suceso } from '@/components/App/Board/Timeline'
import { boardHref, type FiltrosDelTablero } from '@/components/App/Board/href'
import { useI18n } from '@/lib/i18n'

export interface ConductorElegido {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  status: string | null
  statusNote: string | null
  cdlClass: string | null
  licenseState: string | null
  truck: { id: string; unitNumber: string } | null
  trailer: { id: string; unitNumber: string } | null
  currentLoad: { id: string; loadNumber: string; status: string; commodity: string | null } | null
  timeline: Suceso[]
}

/**
 * El conductor abierto, en el mismo sitio donde estaba su tarjeta.
 *
 * ## Lo que no se inventa
 *
 * La cronología junta lo que se le asignó con las posiciones de las cargas que
 * llevó, y nada más. Las posiciones entran POR CARGA —no hay un registro de
 * dispositivos por conductor—, así que un conductor sin carga en curso no tiene
 * posición, y la lista se queda corta en vez de colocarlo donde estuvo ayer.
 * Es la misma regla que sigue el mapa. Ver `Support\Drivers\DriverTimeline`.
 *
 * El camión y el remolque son los de su equipo HABITUAL, no los de la carga que
 * lleve hoy: la pregunta de esta columna es «¿con qué anda?», que se contesta
 * igual esté llevando algo o no.
 */
export function DriverPanel({ conductor, filtros }: { conductor: ConductorElegido; filtros: FiltrosDelTablero }) {
  const { t } = useI18n()
  const nombre = `${conductor.firstName} ${conductor.lastName}`
  const equipo = [conductor.truck?.unitNumber, conductor.trailer?.unitNumber].filter(
    (v) => v !== undefined && v !== null && v !== '',
  )

  return (
    <div className="flex flex-col gap-3 rounded border border-navy-300 bg-white p-3.5 shadow-sm">
      <div className="flex items-start gap-2.5">
        <Avatar id={conductor.id} firstName={conductor.firstName} lastName={conductor.lastName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-navy-800">{nombre}</p>
          <p className="mt-0.5">
            <DriverStatusBadge value={conductor.status} />
          </p>
        </div>

        <Link
          href={boardHref(filtros)}
          preserveScroll
          aria-label={t('common.actions.close')}
          className="rounded px-2 py-1 text-lg leading-none text-steel-600 transition hover:bg-steel-100 hover:text-carbon"
        >
          <span aria-hidden="true">×</span>
        </Link>
      </div>

      {/* El motivo del estado, cuando lo hay: «en pausa» sin decir por qué
          obliga a preguntar por teléfono a quien lo puso. */}
      {conductor.statusNote === null || conductor.statusNote === '' ? null : (
        <p className="rounded bg-navy-50 p-2 text-xs text-navy-800">{conductor.statusNote}</p>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-steel-600">{t('common.labels.phone')}</dt>
        <dd>
          {conductor.phone === null || conductor.phone === '' ? (
            <span className="text-steel-500">{t('board.drivers.noPhone')}</span>
          ) : (
            <a
              href={`tel:${conductor.phone}`}
              title={t('board.drivers.call', { name: nombre })}
              className="font-medium tabular-nums text-navy-700 hover:underline"
            >
              {conductor.phone}
            </a>
          )}
        </dd>

        <dt className="text-steel-600">{t('common.labels.email')}</dt>
        <dd className={conductor.email === null ? 'text-steel-500' : 'text-carbon'}>
          {conductor.email ?? t('common.labels.none')}
        </dd>

        <dt className="text-steel-600">{t('board.panel.driver.cdl')}</dt>
        <dd className={conductor.cdlClass === null ? 'text-steel-500' : 'text-carbon'}>
          {conductor.cdlClass === null
            ? t('common.labels.none')
            : `${conductor.cdlClass}${conductor.licenseState === null ? '' : ` · ${conductor.licenseState}`}`}
        </dd>

        <dt className="text-steel-600">{t('board.panel.driver.equipment')}</dt>
        <dd className={equipo.length === 0 ? 'text-steel-500' : 'tabular-nums text-carbon'}>
          {equipo.length === 0 ? t('board.drivers.noEquipment') : equipo.join(' · ')}
        </dd>
      </dl>

      <section className="rounded border border-steel-200 p-2.5">
        <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-safety-600">
          {t('board.panel.driver.currentLoad')}
        </h3>

        {conductor.currentLoad === null ? (
          <p className="mt-1.5 text-sm text-steel-600">{t('board.panel.driver.noLoad')}</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Link
              href={boardHref(filtros, { load: conductor.currentLoad.id })}
              preserveScroll
              className="text-sm font-semibold tabular-nums text-navy-800 hover:underline"
            >
              {conductor.currentLoad.loadNumber}
            </Link>
            <StatusBadge family="load" value={conductor.currentLoad.status} />
            {conductor.currentLoad.commodity === null ? null : (
              <span className="w-full truncate text-xs text-steel-600">
                {conductor.currentLoad.commodity}
              </span>
            )}
          </div>
        )}
      </section>

      <section>
        <h3 className="pb-2 text-xs font-bold uppercase tracking-[0.1em] text-safety-600">
          {t('board.panel.tabs.history')}
        </h3>
        <Timeline sucesos={conductor.timeline} vacio={t('board.panel.driver.noTimeline')} filtros={filtros} />
      </section>

      <Link
        href={`/drivers/${conductor.id}`}
        className="text-xs font-semibold text-navy-700 underline-offset-2 hover:underline"
      >
        {t('board.panel.driver.openFull')}
      </Link>
    </div>
  )
}
