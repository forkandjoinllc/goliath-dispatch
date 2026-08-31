import { Link, router } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { Pager, type PageMeta } from '@/components/App/Pager'
import { useI18n } from '@/lib/i18n'

interface Preview {
  origin: string
  body: string
  systemKey: string | null
  systemParams: Record<string, string> | null
  createdAt: string
  senderUserId: string | null
}

interface Thread {
  id: string
  subject: string | null
  kind: string
  loadId: string | null
  loadNumber: string | null
  lastMessageAt: string | null
  unread: number
  preview: Preview | null
}

interface Props {
  threads: { data: Thread[]; meta: PageMeta }
  filters: { kind: string | null; q: string | null }
  kinds: string[]
}

/**
 * La bandeja.
 *
 * Lo que se ve aquí son los hilos EN LOS QUE ESTÁS, no los de tu empresa. Es la
 * única lista del sistema donde el alcance del rol no basta y hace falta
 * pertenecer — ver App\Support\Messaging\MessageScope. La descripción de la
 * pantalla lo dice en voz alta a propósito: una bandeja que parece incompleta
 * sin explicar por qué es una bandeja en la que nadie confía.
 */
export default function MessagesIndexPage({ threads, filters, kinds }: Props) {
  const { t } = useI18n()

  const filtrar = (cambios: Record<string, string | null>) =>
    router.get('/messages', { ...filters, ...cambios }, { preserveState: true, replace: true })

  const filtrado = (filters.kind ?? '') !== '' || (filters.q ?? '') !== ''

  return (
    <AppLayout
      title={t('messages.index.title')}
      heading={t('messages.index.title')}
      description={t('messages.index.description')}
      crumbs={[{ label: t('messages.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-wrap items-end gap-4 rounded border border-steel-200 bg-white p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('messages.index.kindLabel')}</span>
            <select
              value={filters.kind ?? ''}
              onChange={(e) => filtrar({ kind: e.target.value || null })}
              className="rounded border border-steel-300 px-3 py-2 text-sm"
            >
              <option value="">{t('messages.index.allKinds')}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>{t(`messages.kind.${k}`)}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('messages.index.searchLabel')}</span>
            <input
              type="search"
              defaultValue={filters.q ?? ''}
              onBlur={(e) => filtrar({ q: e.target.value || null })}
              onKeyDown={(e) => { if (e.key === 'Enter') filtrar({ q: e.currentTarget.value || null }) }}
              className="rounded border border-steel-300 px-3 py-2 text-sm"
            />
          </label>
        </section>

        <section className="rounded border border-steel-200 bg-white">
          {threads.data.length === 0 ? (
            <p className="p-4 text-sm text-steel-600">
              {filtrado ? t('messages.index.emptyFiltered') : t('messages.index.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-steel-100">
              {threads.data.map((h) => (
                <Fila key={h.id} hilo={h} />
              ))}
            </ul>
          )}
        </section>

        <Pager meta={threads.meta} path="/messages" params={{ ...filters }} />
      </div>
    </AppLayout>
  )
}

function Fila({ hilo }: { hilo: Thread }) {
  const { t } = useI18n()

  return (
    <li>
      <Link href={`/messages/${hilo.id}`} className="block px-4 py-3 transition hover:bg-steel-50">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-carbon">
            <span className="mr-2 rounded bg-steel-100 px-2 py-0.5 text-xs font-medium text-steel-700">
              {t(`messages.kind.${hilo.kind}`)}
            </span>
            {hilo.loadNumber ?? hilo.subject ?? '—'}
          </p>

          <span className="flex items-center gap-2 text-xs text-steel-600">
            {hilo.unread > 0 ? (
              <span className="rounded-full bg-navy-700 px-2 py-0.5 text-xs font-semibold text-white">
                {t('messages.index.unread', { n: hilo.unread })}
              </span>
            ) : null}
            {hilo.lastMessageAt ?? ''}
          </span>
        </div>

        <p className="mt-1 truncate text-sm text-steel-700">
          {hilo.preview === null
            ? t('messages.index.noMessages')
            : <Vista preview={hilo.preview} />}
        </p>
      </Link>
    </li>
  )
}

/**
 * La línea de vista previa.
 *
 * Para un mensaje de sistema se traduce la CLAVE, no se pinta el `body`. El
 * `body` quedó redactado en el idioma de la empresa cuando ocurrió el hecho; la
 * clave se traduce al de quien está mirando ahora. Es la razón entera de que el
 * esquema guarde `system_key` y `system_params` en vez de una frase.
 */
function Vista({ preview }: { preview: Preview }) {
  const { t } = useI18n()

  if (preview.origin !== 'system' || preview.systemKey === null) {
    return <>{preview.body}</>
  }

  return <span className="italic text-steel-600">{textoDeSistema(t, preview.systemKey, preview.systemParams)}</span>
}

/** Traduce un mensaje de sistema, con los estados de carga también traducidos. */
export function textoDeSistema(
  t: (k: string, p?: Record<string, string | number>) => string,
  key: string,
  params: Record<string, string> | null,
): string {
  const p: Record<string, string> = { ...(params ?? {}) }

  // `from` y `to` llegan como CLAVES de estado (`in_transit`), no como
  // etiquetas. Se traducen aquí, en el idioma de quien lee, igual que la frase
  // que las contiene.
  for (const campo of ['from', 'to']) {
    if (typeof p[campo] === 'string') {
      p[campo] = t(`nav.status.load.${p[campo].replace(/_(.)/g, (_, c: string) => c.toUpperCase())}`)
    }
  }

  return t(`messages.system.${key}`, p)
}
