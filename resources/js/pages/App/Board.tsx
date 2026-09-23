import { Link, router } from '@inertiajs/react'
import { useEffect, type ReactNode } from 'react'
import { StatusBadge } from '@/components/App/StatusBadge'
import { Avatar } from '@/components/App/Board/Avatar'
import { BoardMap, type MapaDelTablero } from '@/components/App/Board/BoardMap'
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
export default function Board({ tab, tabs, counts, can, loads, drivers, map, refreshedAt }: Props) {
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

  const hora = new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
    timeStyle: 'short',
  }).format(new Date(refreshedAt))

  return (
    <AppLayout
      title={t('board.title')}
      description={t('board.subtitle')}
      crumbs={[{ label: t('board.title') }]}
      actions={
        <p className="text-xs text-steel-600">
          {t('board.refreshed.label', { time: hora })} · {t('board.refreshed.auto')}
        </p>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)_20rem]">
        <Columna title={t('board.loads.title')}>
          {can.loads ? (
            <>
              <Pestanas tab={tab} tabs={tabs} counts={counts} />
              <div className="mt-3 flex flex-col gap-3">
                {loads.length === 0 ? (
                  <Vacio texto={t(vacioDe(tab))} />
                ) : (
                  loads.map((carga) => <TarjetaDeCarga key={carga.id} carga={carga} />)
                )}
              </div>
            </>
          ) : (
            <Vacio texto={t('board.loads.denied')} />
          )}
        </Columna>

        <Columna title={t('board.map.title')}>
          <div className="h-[34rem]">
            <BoardMap mapa={map} />
          </div>
        </Columna>

        <Columna title={t('board.drivers.title')}>
          {can.drivers ? (
            <div className="flex flex-col gap-3">
              {drivers.length === 0 ? (
                <Vacio texto={t('board.drivers.empty')} />
              ) : (
                drivers.map((conductor) => (
                  <TarjetaDeConductor key={conductor.id} conductor={conductor} />
                ))
              )}
            </div>
          ) : (
            <Vacio texto={t('board.drivers.denied')} />
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

function Pestanas({ tab, tabs, counts }: { tab: string; tabs: string[]; counts: Record<string, number> }) {
  const { t } = useI18n()

  return (
    <div className="flex flex-wrap gap-1" role="tablist">
      {tabs.map((clave) => {
        const activa = clave === tab

        return (
          <Link
            key={clave}
            href={`/home?tab=${clave}`}
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
function TarjetaDeCarga({ carga }: { carga: Carga }) {
  const { t, locale } = useI18n()
  const equipo = [carga.truck, carga.trailer].filter((v) => v !== null && v !== '')

  return (
    <Link
      href={`/loads/${carga.id}`}
      className="flex flex-col gap-2.5 rounded border border-steel-200 bg-white p-3.5 transition hover:border-navy-300 hover:shadow-sm"
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

/**
 * El punto de estado: verde libre, azul cargado, gris ni una cosa ni otra.
 *
 * Los tonos son los que la marca DEFINE —500 y 700, no 600—. Escribir un tono
 * que no existe no da error: Tailwind no genera la clase y el punto sale sin
 * color, que fue justo lo que pasó — los dos grises se veían y los dos de color
 * no.
 */
const PUNTO: Record<string, string> = {
  available: 'bg-success-500',
  on_load: 'bg-info-500',
  off_duty: 'bg-steel-400',
  inactive: 'bg-steel-400',
}

function TarjetaDeConductor({ conductor }: { conductor: EnLaFlota }) {
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
            href={`/drivers/${conductor.id}`}
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
        <span className="inline-flex items-center gap-1.5 text-steel-700">
          <span
            aria-hidden="true"
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              PUNTO[conductor.status ?? ''] ?? 'bg-steel-400'
            }`}
          />
          {/* Las MISMAS palabras que la ficha del conductor: un segundo juego
              de nombres para los mismos cuatro estados acabaría diciendo otra
              cosa. */}
          {conductor.status === null ? '—' : t(`drivers.status.${conductor.status}`)}
        </span>

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

function Columna({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
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
