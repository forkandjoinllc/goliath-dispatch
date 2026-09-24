import { Link, router } from '@inertiajs/react'
import { useEffect, type ReactNode } from 'react'
import { StatusBadge } from '@/components/App/StatusBadge'
import { Avatar } from '@/components/App/Board/Avatar'
import { DriverStatusDot } from '@/components/App/DriverStatus'
import { BoardMap, type MapaDelTablero } from '@/components/App/Board/BoardMap'
import { BoardFilters, type FiltroDeTransportista, type PeriodoDelTablero } from '@/components/App/Board/Filters'
import { DriverPanel, type ConductorElegido } from '@/components/App/Board/DriverPanel'
import { LoadPanel, type CargaElegida } from '@/components/App/Board/LoadPanel'
import { QuickAdd, type AltaRapida } from '@/components/App/Board/QuickAdd'
import { boardHref, type FiltrosDelTablero } from '@/components/App/Board/href'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Conductor {
  id: string
  firstName: string
  lastName: string
  status: string | null
}

interface Parada {
  type: string
  at: string | null
  zone: string
  city: string | null
  state: string | null
  name: string | null
}

interface Carga {
  id: string
  loadNumber: string
  status: string
  commodity: string | null
  customerName: string | null
  driver: Conductor | null
  truck: string | null
  trailer: string | null
  nextStop: Parada | null
}

interface EnLaFlota {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  status: string | null
  truck: { id: string; unitNumber: string } | null
  trailer: { id: string; unitNumber: string } | null
}

interface Props {
  tab: string
  tabs: string[]
  counts: Record<string, number>
  can: { loads: boolean; drivers: boolean }
  loads: Carga[]
  drivers: EnLaFlota[]
  map: MapaDelTablero
  period: PeriodoDelTablero
  carrierFilter: FiltroDeTransportista
  quickAdd: AltaRapida
  selectedLoad: CargaElegida | null
  selectedDriver: ConductorElegido | null
  refreshedAt: string
}

/** Cada minuto, ni más ni menos. Lo pidió quien lo va a mirar. */
const CADA = 60_000

/**
 * El tablero de despacho.
 *
 * Tres columnas que contestan la misma pregunta por tres caminos: qué hay que
 * mover, dónde está, y quién puede moverlo.
 */
export default function Board({
  tab,
  tabs,
  counts,
  can,
  loads,
  drivers,
  map,
  period,
  carrierFilter,
  quickAdd,
  selectedLoad,
  selectedDriver,
  refreshedAt,
}: Props) {
  const { t, locale } = useI18n()

  /*
   * Se refresca solo con una recarga PARCIAL: vuelven las cargas, el mapa, los
   * conductores y las cuentas, y no vuelve el armazón. Una recarga de Inertia
   * conserva el estado del componente por su cuenta, así que lo que la persona
   * estaba tocando —el encuadre del mapa, el desplazamiento de la lista— se
   * queda quieto mientras los datos se renuevan debajo.
   */
  useEffect(() => {
    const reloj = window.setInterval(() => {
      router.reload({
        only: ['loads', 'drivers', 'map', 'counts', 'refreshedAt'],
      })
    }, CADA)

    return () => { window.clearInterval(reloj) }
  }, [])

  /*
   * Los filtros viajan en los enlaces de dentro del tablero.
   *
   * `router.reload` conserva la URL entera, así que el refresco de cada minuto
   * no los pierde. Los ENLACES sí los perderían: abrir una carga con
   * `/home?tab=x&load=y` devolvería el tablero a «hoy» y sin transportista, y
   * al cerrar el panel la lista de debajo sería otra. Es el mismo defecto que
   * tenía la pestaña, con otra ropa.
   */
  const filtros = {
    tab,
    period: period.key,
    ...(period.key === 'custom' ? { from: period.from, to: period.to } : {}),
    ...(carrierFilter.selected === null ? {} : { carrier: carrierFilter.selected }),
  }

  const hora = new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
    timeStyle: 'short',
  }).format(new Date(refreshedAt))

  return (
    <AppLayout
      bleed
      title={t('board.title')}
      description={t('board.subtitle')}
      crumbs={[{ label: t('board.title') }]}
      actions={
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          {/* Los filtros ANTES de las acciones rápidas: primero se decide qué
              se está mirando, y después se añade. */}
          <BoardFilters period={period} carrier={carrierFilter} tab={tab} />
          <QuickAdd quickAdd={quickAdd} />
          <p className="pb-1.5 text-xs text-steel-600">
            {t('board.refreshed.label', { time: hora })} · {t('board.refreshed.auto')}
          </p>
        </div>
      }
    >
      {/*
        Las cargas pegadas al borde izquierdo, los conductores al derecho, y todo
        lo de en medio es mapa. Las tres columnas se separan con una línea y no
        con aire: en una pantalla que se mira de reojo todo el día, el borde es
        lo que dice dónde acaba una cosa y empieza otra.

        En pantalla estrecha se apilan y el mapa va primero, porque es lo que no
        cabe en una lista.
      */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-steel-200 xl:grid xl:grid-cols-[21rem_minmax(0,1fr)_19rem]">
        <Columna
          title={t('board.loads.title')}
          className="order-2 border-steel-200 xl:order-1 xl:border-r"
        >
          {! can.loads ? (
            <Vacio texto={t('board.loads.denied')} />
          ) : selectedLoad !== null ? (
            /*
              La carga abierta OCUPA el sitio de la lista, no se abre encima.
              Es lo que se pidió —«en el mismo espacio de la izquierda»— y
              además es lo que deja el mapa entero a la vista mientras se lee.
            */
            <LoadPanel carga={selectedLoad} customers={quickAdd.customers} filtros={filtros} />
          ) : (
            <>
              <Pestanas tab={tab} tabs={tabs} counts={counts} filtros={filtros} />
              <div className="mt-3 flex flex-col gap-3">
                {loads.length === 0 ? (
                  <Vacio texto={t(vacioDe(tab))} />
                ) : (
                  loads.map((carga) => (
                    <TarjetaDeCarga key={carga.id} carga={carga} filtros={filtros} />
                  ))
                )}
              </div>
            </>
          )}
        </Columna>

        {/* El mapa no lleva título: ocupa el centro entero y se explica solo. */}
        <div className="order-1 flex min-h-[26rem] min-w-0 flex-col bg-white xl:order-2 xl:h-full">
          <BoardMap mapa={map} />
        </div>

        <Columna
          title={t('board.drivers.title')}
          className="order-3 border-steel-200 xl:border-l"
        >
          {! can.drivers ? (
            <Vacio texto={t('board.drivers.denied')} />
          ) : selectedDriver !== null ? (
            <DriverPanel conductor={selectedDriver} filtros={filtros} />
          ) : (
            <div className="flex flex-col gap-3">
              {drivers.length === 0 ? (
                <Vacio texto={t('board.drivers.empty')} />
              ) : (
                drivers.map((conductor) => (
                  <TarjetaDeConductor key={conductor.id} conductor={conductor} filtros={filtros} />
                ))
              )}
            </div>
          )}
        </Columna>
      </div>
    </AppLayout>
  )
}

function vacioDe(tab: string): string {
  if (tab === 'assigned') return 'board.loads.emptyAssigned'
  if (tab === 'done') return 'board.loads.emptyDone'

  return 'board.loads.emptyUnassigned'
}

function Pestanas({
  tab,
  tabs,
  counts,
  filtros,
}: {
  tab: string
  tabs: string[]
  counts: Record<string, number>
  filtros: FiltrosDelTablero
}) {
  const { t } = useI18n()

  return (
    <div className="flex flex-wrap gap-1" role="tablist">
      {tabs.map((clave) => {
        const activa = clave === tab

        return (
          <Link
            key={clave}
            href={boardHref({ ...filtros, tab: clave })}
            preserveScroll
            role="tab"
            aria-selected={activa}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
              activa ? 'bg-navy-700 text-white' : 'bg-steel-100 text-navy-800 hover:bg-navy-50'
            }`}
          >
            {t(`board.tabs.${clave}`)}
            <span className="ml-1.5 tabular-nums opacity-80">{counts[clave] ?? 0}</span>
          </Link>
        )
      })}
    </div>
  )
}

/** Cada carga es una tarjeta, y la tarjeta entera lleva a la carga. */
function TarjetaDeCarga({ carga, filtros }: { carga: Carga; filtros: FiltrosDelTablero }) {
  const { t, locale } = useI18n()
  const equipo = [carga.truck, carga.trailer].filter((v) => v !== null && v !== '')

  return (
    /*
      Pulsar una tarjeta ABRE EL PANEL, no manda a la ficha. La selección viaja
      en la URL —`?load=`— y no en el estado del componente: el enlace se pega
      en un mensaje, el botón de atrás cierra el panel, y un refresco no pierde
      lo que se estaba mirando. `preserveScroll` para que la columna no salte
      al principio al abrir.
    */
    <Link
      href={boardHref(filtros, { load: carga.id })}
      preserveScroll
      className="flex flex-col gap-2.5 rounded border border-steel-200 bg-white p-3.5 text-left transition hover:border-navy-300 hover:shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold tabular-nums text-navy-800">{carga.loadNumber}</span>
        <span className="ml-auto">
          <StatusBadge family="load" value={carga.status} />
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        {carga.driver === null ? (
          <>
            <span
              aria-hidden="true"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-steel-300 text-steel-500"
            >
              ?
            </span>
            <span className="text-sm font-medium text-steel-600">{t('board.loads.noDriver')}</span>
          </>
        ) : (
          <>
            <Avatar
              id={carga.driver.id}
              firstName={carga.driver.firstName}
              lastName={carga.driver.lastName}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-carbon">
                {carga.driver.firstName} {carga.driver.lastName}
              </span>
              {/* La combinación, tal y como se dice en la radio: «101 · T-220». */}
              <span className="block truncate text-xs tabular-nums text-steel-600">
                {equipo.length === 0 ? t('board.loads.noEquipment') : equipo.join(' · ')}
              </span>
            </span>
          </>
        )}
      </div>

      <p className="truncate text-sm text-navy-800">
        {carga.customerName ?? t('board.loads.noCustomer')}
      </p>

      {/* Recogida o entrega DICHO, no una fecha suelta que hay que adivinar. */}
      {carga.nextStop === null ? (
        <p className="text-xs text-steel-600">{t('board.loads.noStop')}</p>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span
            className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${
              carga.nextStop.type === 'pickup'
                ? 'bg-safety-100 text-safety-800'
                : 'bg-navy-100 text-navy-800'
            }`}
          >
            {t(`board.stop.${carga.nextStop.type}`)}
          </span>
          <span className="tabular-nums text-steel-700">
            {carga.nextStop.at === null
              ? t('board.loads.noDate')
              : `${cuando(carga.nextStop.at, locale)} · ${carga.nextStop.zone}`}
          </span>
          {carga.nextStop.city === null ? null : (
            <span className="text-steel-600">
              {carga.nextStop.city}
              {carga.nextStop.state === null ? '' : `, ${carga.nextStop.state}`}
            </span>
          )}
        </p>
      )}
    </Link>
  )
}

/**
 * La hora del muelle, ya resuelta por el servidor.
 *
 * Llega como «2026-09-16 02:00» en el reloj del muelle y aquí solo se le da
 * formato. Construir un `Date` con la cadena tal cual la trataría como hora
 * local del navegador, que es lo que queremos: el valor YA está en el reloj
 * correcto y no hay que volver a moverlo. Ver `App\Support\Loads\LoadClock`.
 */
function cuando(at: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at.replace(' ', 'T')))
}

function TarjetaDeConductor({ conductor, filtros }: { conductor: EnLaFlota; filtros: FiltrosDelTablero }) {
  const { t } = useI18n()
  const equipo = [conductor.truck?.unitNumber, conductor.trailer?.unitNumber].filter(
    (v) => v !== undefined && v !== null && v !== '',
  )
  const nombre = `${conductor.firstName} ${conductor.lastName}`

  return (
    <div className="flex flex-col gap-2 rounded border border-steel-200 bg-white p-3.5">
      <div className="flex items-center gap-2.5">
        <Avatar id={conductor.id} firstName={conductor.firstName} lastName={conductor.lastName} />
        <span className="min-w-0 flex-1">
          <Link
            href={boardHref(filtros, { driver: conductor.id })}
            preserveScroll
            className="block truncate text-sm font-medium text-navy-800 hover:underline"
          >
            {nombre}
          </Link>
          <span className="block truncate text-xs tabular-nums text-steel-600">
            {equipo.length === 0 ? t('board.drivers.noEquipment') : equipo.join(' · ')}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <DriverStatusDot value={conductor.status} />

        {conductor.phone === null || conductor.phone === '' ? (
          <span className="text-steel-500">{t('board.drivers.noPhone')}</span>
        ) : (
          <a
            href={`tel:${conductor.phone}`}
            title={t('board.drivers.call', { name: nombre })}
            className="tabular-nums font-medium text-navy-700 hover:underline"
          >
            {conductor.phone}
          </a>
        )}
      </div>
    </div>
  )
}

/**
 * Una columna del tablero, pegada a su borde y con su propio desplazamiento.
 *
 * El desplazamiento es SUYO y no de la página: si la lista de cargas arrastrara
 * la página entera, el mapa se iría hacia arriba al bajar por las cargas, que
 * es exactamente lo que no puede pasar en la pantalla donde se mira el mapa
 * mientras se lee la lista.
 */
function Columna({
  title,
  className,
  children,
}: {
  title: string
  className: string
  children: ReactNode
}) {
  return (
    <section className={`flex min-h-0 flex-col overflow-y-auto bg-navy-50 p-4 ${className}`}>
      <h2 className="pb-2 text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Vacio({ texto }: { texto: string }) {
  return (
    <p className="rounded border border-dashed border-steel-300 p-4 text-sm text-steel-700">
      {texto}
    </p>
  )
}
