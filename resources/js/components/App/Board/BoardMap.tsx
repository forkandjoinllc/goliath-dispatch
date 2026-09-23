import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { GOTA, colorParada, colorUnidad, siluetaDe } from './pins'

export interface Parada {
  id: string
  loadId: string
  loadNumber: string | null
  type: string
  lat: number
  lng: number
  name: string | null
  city: string | null
  state: string | null
}

export interface Unidad {
  loadId: string
  loadNumber: string
  lat: number
  lng: number
  at: string
  provider: string
  label: string | null
  driverName: string | null
  truck: string | null
  trailer: string | null
  trailerType: string | null
}

export interface MapaDelTablero {
  provider: string
  live: boolean
  config: { apiKey?: string; mapId?: string | null }
  stops: Parada[]
  units: Unidad[]
  withoutSignal: number
}

/* ── La proyección ───────────────────────────────────────────────────────── */

/**
 * Web Mercator, la misma que usa cualquier mapa de teselas.
 *
 * Se escribe aquí porque el mapa de fondo liso tiene que colocar los puntos en
 * el mismo sitio relativo en el que los colocaría Google. Con una proyección
 * distinta —longitud y latitud repartidas a partes iguales— Texas saldría
 * estirado y Minnesota aplastado, y quien compare las dos instalaciones vería
 * dos mapas que no son el mismo.
 */
function mercator(lat: number, lng: number): { x: number; y: number } {
  const seno = Math.sin((lat * Math.PI) / 180)
  const acotado = Math.max(-0.9999, Math.min(0.9999, seno))

  return {
    x: (lng + 180) / 360,
    y: 0.5 - Math.log((1 + acotado) / (1 - acotado)) / (4 * Math.PI),
  }
}

const ANCHO = 900
const ALTO = 620
/** Margen para que un PIN pegado al borde no se corte. */
const MARGEN = 60

/* ── El mapa de fondo liso ───────────────────────────────────────────────── */

function MapaLiso({ stops, units }: { stops: Parada[]; units: Unidad[] }) {
  const { t } = useI18n()

  const puntos = useMemo(
    () => [
      ...stops.map((s) => mercator(s.lat, s.lng)),
      ...units.map((u) => mercator(u.lat, u.lng)),
    ],
    [stops, units],
  )

  /** El encuadre que mete todos los puntos dentro, con su margen. */
  const encuadre = useMemo(() => {
    if (puntos.length === 0) return { cx: 0.5, cy: 0.5, escala: ANCHO }

    const xs = puntos.map((p) => p.x)
    const ys = puntos.map((p) => p.y)
    const anchoMapa = Math.max(...xs) - Math.min(...xs)
    const altoMapa = Math.max(...ys) - Math.min(...ys)

    // Un solo punto no tiene extensión: se le da una para no dividir por cero
    // y para que no quede pegado a la lente.
    const escala = Math.min(
      (ANCHO - MARGEN * 2) / Math.max(anchoMapa, 0.004),
      (ALTO - MARGEN * 2) / Math.max(altoMapa, 0.004),
    )

    return {
      cx: (Math.max(...xs) + Math.min(...xs)) / 2,
      cy: (Math.max(...ys) + Math.min(...ys)) / 2,
      escala,
    }
  }, [puntos])

  const [vista, setVista] = useState(encuadre)

  // Cuando llegan puntos nuevos con el refresco, el encuadre cambia. No se
  // vuelve a encuadrar solo: quien acaba de acercarse a Laredo no quiere que el
  // mapa dé un salto cada minuto. Solo se encuadra si nunca se tocó.
  const tocado = useRef(false)

  useEffect(() => {
    if (! tocado.current) setVista(encuadre)
  }, [encuadre])

  const px = (lat: number, lng: number) => {
    const m = mercator(lat, lng)

    return {
      x: (m.x - vista.cx) * vista.escala + ANCHO / 2,
      y: (m.y - vista.cy) * vista.escala + ALTO / 2,
    }
  }

  const zoom = (factor: number) => {
    tocado.current = true
    setVista((v) => ({ ...v, escala: v.escala * factor }))
  }

  const recentrar = () => {
    tocado.current = false
    setVista(encuadre)
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded bg-steel-100">
      <svg
        viewBox={`0 0 ${String(ANCHO)} ${String(ALTO)}`}
        className="h-full w-full"
        role="img"
        aria-label={t('board.map.title')}
      >
        {/* Una cuadrícula tenue: sin ella no se nota que el mapa se mueve al
            acercar, y un zoom que no se ve es un zoom que parece roto. */}
        <defs>
          <pattern id="rejilla" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0V48" fill="none" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={ANCHO} height={ALTO} fill="url(#rejilla)" className="text-steel-200" />

        {stops.map((parada) => {
          const p = px(parada.lat, parada.lng)

          return (
            /* Escalados: a tamaño natural la letra de dentro del PIN no se lee
               en la caja que le toca a la columna del medio, y un PIN cuya letra
               no se lee es un PIN que no dice si es recogida o entrega. */
            <g key={parada.id} transform={`translate(${String(p.x)} ${String(p.y)}) scale(1.5)`}>
              <path d={GOTA} fill={colorParada(parada.type)} stroke="white" strokeWidth="1.5" />
              <text
                x="0"
                y="-13.5"
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill="white"
              >
                {parada.type === 'pickup' ? 'P' : 'D'}
              </text>
              <title>
                {`${parada.loadNumber ?? ''} · ${t(`board.stop.${parada.type}`)}${
                  parada.city === null ? '' : ` · ${parada.city}`
                }`}
              </title>
            </g>
          )
        })}

        {units.map((unidad) => {
          const p = px(unidad.lat, unidad.lng)

          return (
            <g key={unidad.loadId} transform={`translate(${String(p.x)} ${String(p.y)}) scale(1.5)`}>
              <circle r="15" fill="white" stroke={colorUnidad()} strokeWidth="2" />
              <path d={siluetaDe(unidad.trailerType)} fill={colorUnidad()} transform="scale(0.62)" />
              <title>
                {[unidad.driverName, unidad.truck, unidad.trailer, unidad.loadNumber]
                  .filter((v) => v !== null && v !== '')
                  .join(' · ')}
              </title>
            </g>
          )
        })}
      </svg>

      <Controles onZoom={zoom} onRecentrar={recentrar} />
    </div>
  )
}

function Controles({
  onZoom,
  onRecentrar,
}: {
  onZoom: (factor: number) => void
  onRecentrar: () => void
}) {
  const { t } = useI18n()

  const boton =
    'flex h-8 w-8 items-center justify-center rounded border border-steel-300 bg-white text-sm font-bold text-navy-800 shadow-sm transition hover:bg-navy-50'

  return (
    <div className="absolute right-3 top-3 flex flex-col gap-1.5">
      <button type="button" className={boton} onClick={() => { onZoom(1.5) }} title={t('board.map.zoomIn')}>
        +<span className="sr-only">{t('board.map.zoomIn')}</span>
      </button>
      <button type="button" className={boton} onClick={() => { onZoom(1 / 1.5) }} title={t('board.map.zoomOut')}>
        −<span className="sr-only">{t('board.map.zoomOut')}</span>
      </button>
      <button type="button" className={boton} onClick={onRecentrar} title={t('board.map.recenter')}>
        <span aria-hidden="true">⌖</span>
        <span className="sr-only">{t('board.map.recenter')}</span>
      </button>
    </div>
  )
}

/* ── El mapa con teselas de Google ───────────────────────────────────────── */

/**
 * Carga la API de Google una sola vez, y no la vuelve a cargar si ya está.
 *
 * Que compruebe primero si ya está montada no es una optimización: es lo que
 * permite probar esta mitad sin cuenta de Google, poniendo un doble en
 * `window.google` antes de que la pantalla monte. Sin eso, el único camino a
 * este código sería una clave de verdad, y un camino que no se puede recorrer
 * es un camino que no se prueba nunca.
 */
function cargarGoogle(apiKey: string): Promise<unknown> {
  const w = window as unknown as { google?: { maps?: unknown }; __goliathMapa?: Promise<unknown> }

  if (w.google?.maps !== undefined) return Promise.resolve(w.google.maps)
  if (w.__goliathMapa !== undefined) return w.__goliathMapa

  w.__goliathMapa = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`
    script.async = true
    script.onload = () => { resolve(w.google?.maps) }
    script.onerror = () => { reject(new Error('maps')) }
    document.head.appendChild(script)
  })

  return w.__goliathMapa
}

interface MapaGoogle {
  Map: new (el: HTMLElement, opciones: Record<string, unknown>) => {
    fitBounds: (limites: unknown, margen?: number) => void
  }
  Marker: new (opciones: Record<string, unknown>) => { setMap: (m: unknown) => void }
  LatLngBounds: new () => { extend: (p: { lat: number; lng: number }) => void }
}

function MapaConTeselas({ mapa }: { mapa: MapaDelTablero }) {
  const { t } = useI18n()
  const lienzo = useRef<HTMLDivElement | null>(null)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    let vivo = true

    void cargarGoogle(mapa.config.apiKey ?? '')
      .then((api) => {
        if (! vivo || lienzo.current === null) return

        const g = api as MapaGoogle
        // Los controles de zoom son los de Google: son los que la gente ya
        // sabe usar, y duplicarlos con los nuestros sería poner dos.
        const vista = new g.Map(lienzo.current, {
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapId: mapa.config.mapId ?? undefined,
          center: { lat: 39.5, lng: -98.35 },
          zoom: 4,
        })

        const limites = new g.LatLngBounds()

        for (const parada of mapa.stops) {
          limites.extend({ lat: parada.lat, lng: parada.lng })
          new g.Marker({
            map: vista,
            position: { lat: parada.lat, lng: parada.lng },
            title: `${parada.loadNumber ?? ''} · ${t(`board.stop.${parada.type}`)}`,
            label: { text: parada.type === 'pickup' ? 'P' : 'D', color: 'white', fontWeight: '700' },
            icon: {
              path: GOTA,
              fillColor: colorParada(parada.type),
              fillOpacity: 1,
              strokeColor: 'white',
              strokeWeight: 1.5,
              scale: 1.1,
              labelOrigin: { x: 0, y: -17 },
            },
          })
        }

        for (const unidad of mapa.units) {
          limites.extend({ lat: unidad.lat, lng: unidad.lng })
          new g.Marker({
            map: vista,
            position: { lat: unidad.lat, lng: unidad.lng },
            title: [unidad.driverName, unidad.truck, unidad.trailer].filter(Boolean).join(' · '),
            icon: {
              path: siluetaDe(unidad.trailerType),
              fillColor: colorUnidad(),
              fillOpacity: 1,
              strokeColor: 'white',
              strokeWeight: 1,
              scale: 1.1,
            },
          })
        }

        if (mapa.stops.length + mapa.units.length > 0) vista.fitBounds(limites, 64)
      })
      .catch(() => {
        // Sin teselas se sigue viendo el tablero: se cae al mapa de fondo
        // liso, que coloca los mismos puntos en el mismo sitio.
        if (vivo) setFallo(true)
      })

    return () => {
      vivo = false
    }
  }, [mapa, t])

  if (fallo) return <MapaLiso stops={mapa.stops} units={mapa.units} />

  return <div ref={lienzo} className="h-full w-full rounded bg-steel-100" />
}

/* ── La pieza que elige ──────────────────────────────────────────────────── */

export function BoardMap({ mapa }: { mapa: MapaDelTablero }) {
  const { t } = useI18n()
  const vacio = mapa.stops.length === 0 && mapa.units.length === 0

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="min-h-[24rem] flex-1">
        {vacio ? (
          <div className="flex h-full items-center justify-center rounded bg-steel-100 p-6 text-center text-sm text-steel-700">
            {t('board.map.empty')}
          </div>
        ) : mapa.live ? (
          <MapaConTeselas mapa={mapa} />
        ) : (
          <MapaLiso stops={mapa.stops} units={mapa.units} />
        )}
      </div>

      <Leyenda mapa={mapa} />
    </div>
  )
}

function Leyenda({ mapa }: { mapa: MapaDelTablero }) {
  const { t } = useI18n()

  return (
    <div className="flex flex-col gap-2 text-xs text-steel-700">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: colorParada('pickup') }}
          />
          {t('board.map.legendPickup')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: colorParada('delivery') }}
          />
          {t('board.map.legendDelivery')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: colorUnidad() }}
          />
          {t('board.map.legendUnit')}
        </span>
      </div>

      {/* Sin teselas se dice, y se dice por qué. Un rectángulo gris sin
          explicación se lee como «esto está cargando» o «esto está roto». */}
      {mapa.live ? null : (
        <p>
          <strong className="font-semibold text-navy-800">{t('board.map.noTiles')}</strong>{' '}
          {t('board.map.noTilesHint')}
        </p>
      )}

      {mapa.withoutSignal > 0 ? (
        <p>
          <strong className="font-semibold text-navy-800">
            {t(
              mapa.withoutSignal === 1 ? 'board.map.withoutSignalOne' : 'board.map.withoutSignal',
              { n: String(mapa.withoutSignal) },
            )}
          </strong>{' '}
          {t('board.map.withoutSignalHint')}
        </p>
      ) : null}
    </div>
  )
}
