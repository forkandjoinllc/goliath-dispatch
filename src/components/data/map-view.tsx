'use client'

import * as React from 'react'
import { MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MapWaypoint {
  id: string
  label: string
  /** Short state/status text shown under the label, e.g. "Delivered" or "TX". */
  subLabel?: string
  kind?: 'pickup' | 'delivery' | 'waypoint'
  lat?: number
  lng?: number
}

export interface LatLng {
  lat: number
  lng: number
}

export interface MapViewLabels {
  noProviderNote: string
  schematicCaption: string
}

export interface MapViewProps {
  waypoints: MapWaypoint[]
  polyline?: LatLng[]
  /** Browser (client-restricted) Google Maps API key. Never read from env here. */
  apiKey?: string | null
  height?: number
  labels: MapViewLabels
  className?: string
}

/**
 * Minimal shape of the pieces of the Google Maps JS API this component
 * calls. Declared locally rather than pulling in `@types/google.maps` — the
 * component degrades to the schematic whenever the real script (loaded at
 * runtime, not as an npm dependency) isn't present.
 */
interface MinimalGoogleMaps {
  maps: {
    LatLngBounds: new () => { extend: (point: LatLng) => void }
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => {
      fitBounds: (bounds: unknown) => void
    }
    Marker: new (opts: { map: unknown; position: LatLng; title?: string }) => unknown
    Polyline: new (opts: { map: unknown; path: LatLng[]; strokeColor?: string; strokeWeight?: number }) => unknown
  }
}

let googleMapsLoader: Promise<void> | null = null

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if ((window as unknown as { google?: unknown }).google) return Promise.resolve()
  if (googleMapsLoader) return googleMapsLoader
  googleMapsLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Maps'))
    document.head.appendChild(script)
  })
  return googleMapsLoader
}

/**
 * Renders a live map when an API key and coordinates are available. With no
 * key configured — the common case in development and for tenants that
 * haven't connected a provider — it renders a clean SVG schematic of the
 * stops in sequence instead of a broken grey box.
 */
export function MapView({ waypoints, polyline, apiKey, height = 320, labels, className }: MapViewProps) {
  const hasCoordinates = waypoints.every((w) => typeof w.lat === 'number' && typeof w.lng === 'number')
  const canRenderLiveMap = Boolean(apiKey) && hasCoordinates && waypoints.length > 0
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = React.useState(false)

  React.useEffect(() => {
    if (!canRenderLiveMap || !apiKey || !containerRef.current) return
    let cancelled = false
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return
        const g = (window as unknown as { google: MinimalGoogleMaps }).google
        const bounds = new g.maps.LatLngBounds()
        const map = new g.maps.Map(containerRef.current, {
          disableDefaultUI: false,
          zoomControl: true,
        })
        for (const wp of waypoints) {
          const position = { lat: wp.lat!, lng: wp.lng! }
          new g.maps.Marker({ map, position, title: wp.label })
          bounds.extend(position)
        }
        if (polyline && polyline.length > 1) {
          new g.maps.Polyline({
            map,
            path: polyline,
            strokeColor: '#062B5C',
            strokeWeight: 3,
          })
          for (const point of polyline) bounds.extend(point)
        }
        map.fitBounds(bounds)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [canRenderLiveMap, apiKey, waypoints, polyline])

  if (canRenderLiveMap && !loadError) {
    return (
      <div
        ref={containerRef}
        role="img"
        aria-label={labels.schematicCaption}
        style={{ height }}
        className={cn('w-full overflow-hidden rounded-lg border border-steel-200 bg-steel-100', className)}
      />
    )
  }

  return <MapSchematic waypoints={waypoints} labels={labels} height={height} className={className} />
}

function MapSchematic({
  waypoints,
  labels,
  height,
  className,
}: {
  waypoints: MapWaypoint[]
  labels: MapViewLabels
  height: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col justify-between gap-4 rounded-lg border border-steel-200 bg-steel-50 p-6',
        className,
      )}
      style={{ minHeight: height }}
    >
      <ol className="flex flex-1 flex-wrap items-center gap-2" aria-label={labels.schematicCaption}>
        {waypoints.map((wp, index) => (
          <React.Fragment key={wp.id}>
            <li className="flex flex-col items-center gap-1 text-center">
              <span
                className={cn(
                  'flex size-9 items-center justify-center rounded-full border-2',
                  wp.kind === 'pickup'
                    ? 'border-navy-700 bg-navy-50 text-navy-700'
                    : wp.kind === 'delivery'
                      ? 'border-safety-500 bg-safety-50 text-safety-700'
                      : 'border-steel-400 bg-white text-steel-600',
                )}
              >
                <MapPin className="size-4" aria-hidden="true" />
              </span>
              <span className="max-w-[7rem] text-xs font-semibold text-carbon">{wp.label}</span>
              {wp.subLabel ? <span className="text-xs text-steel-600">{wp.subLabel}</span> : null}
            </li>
            {index < waypoints.length - 1 ? (
              <li aria-hidden="true" className="h-px w-8 flex-1 bg-steel-300 sm:w-16" />
            ) : null}
          </React.Fragment>
        ))}
      </ol>
      <p className="text-center text-xs text-steel-600">{labels.noProviderNote}</p>
    </div>
  )
}
