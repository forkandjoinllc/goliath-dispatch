import { Link } from '@inertiajs/react'
import { boardHref } from '@/components/App/Board/href'
import { useI18n } from '@/lib/i18n'

export interface Suceso {
  id: string
  type: string
  at: string | null
  zone: string
  detail: Record<string, unknown>
}

/**
 * Una cronología: qué pasó, cuándo, y en el reloj de dónde.
 *
 * ## El huso va escrito
 *
 * Cada línea lleva su zona al lado —CDT, EDT— porque una carga que recoge en
 * Laredo y entrega en Gary cruza dos husos, y una lista de horas sin decir de
 * quién son se lee mal en el único momento en que importa: cuando el cliente
 * pregunta por qué llegó tarde. El servidor ya resolvió cada hora en la del
 * muelle al que pertenece; aquí solo se le da formato.
 *
 * ## Una posición escrita a mano no es un GPS
 *
 * `byPerson` distingue el parte que tecleó alguien de despacho de la posición
 * que mandó el proveedor. Ocupan la misma línea y no valen lo mismo: una dice
 * dónde está el camión, la otra dice dónde dijo alguien que estaba.
 */
export function Timeline({
  sucesos,
  vacio,
  tab,
}: {
  sucesos: Suceso[]
  vacio: string
  tab: string
}) {
  const { t, locale } = useI18n()

  if (sucesos.length === 0) {
    return (
      <p className="rounded border border-dashed border-steel-300 p-3 text-sm text-steel-700">
        {vacio}
      </p>
    )
  }

  return (
    <ol className="flex flex-col">
      {sucesos.map((s, i) => (
        <li key={s.id} className="flex gap-3">
          {/* La línea vertical: un punto por suceso y el hilo entre ellos. */}
          <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
            <span className={`size-2 shrink-0 rounded-full ${COLOR[s.type] ?? 'bg-steel-400'}`} />
            {i === sucesos.length - 1 ? null : <span className="w-px flex-1 bg-steel-200" />}
          </div>

          <div className="min-w-0 pb-4">
            <p className="text-xs tabular-nums text-steel-600">
              {s.at === null ? t('board.loads.noDate') : `${cuando(s.at, locale)} · ${s.zone}`}
            </p>
            <p className="text-sm text-carbon">{titulo(s, t)}</p>
            <Detalle suceso={s} tab={tab} />
          </div>
        </li>
      ))}
    </ol>
  )
}

/**
 * El color del punto por tipo de suceso.
 *
 * Son clases ENTERAS y no `bg-${x}-600` construido al vuelo: Tailwind lee el
 * código fuente para decidir qué clases genera, y una clase montada con una
 * plantilla no aparece en el CSS. Es el defecto que dejó los puntos de estado
 * del tablero sin color hasta el lote 36.
 */
const COLOR: Record<string, string> = {
  created: 'bg-navy-700',
  status: 'bg-navy-500',
  assigned: 'bg-safety-600',
  unassigned: 'bg-steel-500',
  arrived: 'bg-navy-600',
  departed: 'bg-navy-400',
  document: 'bg-steel-600',
  tracking: 'bg-safety-500',
}

function titulo(s: Suceso, t: (k: string, r?: Record<string, string | number>) => string): string {
  const d = s.detail

  if (s.type === 'status') {
    // Los estados viven bajo `nav.status.load.*` y en camello, que es donde los
    // lee `StatusBadge`. Inventarles aquí un `loads.status.*` habría pintado la
    // clave en crudo: `t` devuelve la clave cuando no encuentra la traducción,
    // y una cronología llena de rutas con puntos parece rota sin serlo.
    return t('board.timeline.status', { to: t(`nav.status.load.${camel(String(d.to))}`) })
  }

  if (s.type === 'assigned' || s.type === 'unassigned') {
    const quien = (d.name as string | undefined) ?? (d.loadNumber as string | undefined) ?? ''

    return t(`board.timeline.${s.type}`, { name: quien })
  }

  if (s.type === 'arrived' || s.type === 'departed') {
    return t(`board.timeline.${s.type}`, {
      stop: t(`board.stop.${String(d.stop)}`),
      place: (d.place as string) || '—',
    })
  }

  if (s.type === 'document') {
    return t('board.timeline.document', {
      type: t(`documents.types.${String(d.documentType)}`),
    })
  }

  if (s.type === 'tracking') {
    return d.byPerson === true ? t('board.timeline.checkCall') : t('board.timeline.position')
  }

  return t('board.timeline.created')
}

function Detalle({ suceso, tab }: { suceso: Suceso; tab: string }) {
  const { t } = useI18n()
  const d = suceso.detail
  const trozos: string[] = []

  if (typeof d.place === 'string' && d.place !== '' && suceso.type === 'tracking') {
    trozos.push(d.place)
  }

  if (typeof d.name === 'string' && d.name !== '' && suceso.type === 'document') {
    trozos.push(d.name)
  }

  if (typeof d.note === 'string' && d.note !== '') trozos.push(d.note)

  const carga = typeof d.loadId === 'string' && typeof d.loadNumber === 'string'
    ? { id: d.loadId, number: d.loadNumber }
    : null

  if (trozos.length === 0 && carga === null) return null

  return (
    <p className="text-xs text-steel-600">
      {carga === null || suceso.type === 'assigned' || suceso.type === 'unassigned' ? null : (
        <Link
          href={boardHref(tab, { load: carga.id })}
          preserveScroll
          className="font-medium tabular-nums text-navy-700 hover:underline"
        >
          {carga.number}
        </Link>
      )}
      {trozos.length === 0 ? null : (
        <span className={carga === null ? '' : 'ml-2'}>{trozos.join(t('common.labels.listSeparator'))}</span>
      )}
    </p>
  )
}

/** `pod_received` → `podReceived`. La misma regla que usa `StatusBadge`. */
function camel(value: string): string {
  return value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function cuando(at: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at.replace(' ', 'T')))
}
