import { Link, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Stop {
  id: string
  type: string
  sequence: number
  name: string | null
  city: string | null
  state: string | null
}

interface Papel {
  linkId: string
  documentId: string
  type: string
  title: string
  reviewStatus: string
  filename: string | null
  byteSize: number | null
  contentType: string | null
  malwareScanStatus: string | null
  attachedAt: string
  stop: { id: string; type: string; sequence: number; name: string; city: string; state: string } | null
}

interface Props {
  load: { id: string; number: string; status: string | null; podReceivedAt: string | null }
  documents: Papel[]
  stops: Stop[]
  types: string[]
  podBlocking: string[]
  maxKb: number
  can: { upload: boolean; download: boolean }
}

/**
 * Los papeles de una carga.
 *
 * La pantalla que faltaba. `load_documents` estaba en el esquema desde el
 * principio, con su `stop_id` para decir de qué parada es cada comprobante, y
 * hasta ahora la escribía solo el sembrador de demostración: en producción no
 * había forma de subir un comprobante de entrega, y la puerta que lo exige para
 * poder facturar buscaba además un tipo de documento que el esquema no admite.
 *
 * Por eso lo primero que se ve no es la lista: es si la puerta abre. Quien
 * entra aquí normalmente viene de intentar marcar la carga como «comprobante
 * recibido» y que no le dejaran, y la respuesta a «¿por qué no?» tiene que
 * estar arriba, no al final de una lista.
 */
export default function LoadDocumentsPage({
  load, documents, stops, types, podBlocking, maxKb, can,
}: Props) {
  const { t } = useI18n()

  const mb = Math.floor(maxKb / 1024)
  const bloqueado = podBlocking.length > 0

  return (
    <AppLayout
      title={t('loads.documents.title')}
      heading={load.number}
      description={t('loads.documents.description')}
      crumbs={[
        { label: t('loads.index.title'), href: '/loads' },
        { label: load.number, href: `/loads/${load.id}` },
        { label: t('loads.documents.title') },
      ]}
    >
      <div className="flex flex-col gap-4">
        {load.podReceivedAt !== null ? (
          <p className="rounded border border-success-500 bg-success-50 p-3 text-sm text-success-700">
            {t('loads.documents.podReceivedAt', { date: load.podReceivedAt })}
          </p>
        ) : bloqueado ? (
          <section className="rounded border border-warning-300 bg-warning-50 p-3">
            <p className="text-sm font-semibold text-carbon">{t('loads.documents.podBlockedTitle')}</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-carbon">
              {podBlocking.map((motivo) => (
                <li key={motivo}>{t(`loads.blocking.${motivo}`)}</li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="rounded border border-success-500 bg-success-50 p-3 text-sm text-success-700">
            {t('loads.documents.podReady')}
          </p>
        )}

        {can.upload ? <Subir loadId={load.id} stops={stops} types={types} mb={mb} /> : null}

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('loads.documents.listTitle')}</p>

          {documents.length === 0 ? (
            <p className="mt-2 text-sm text-steel-600">{t('loads.documents.listEmpty')}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {documents.map((d) => (
                <Fila key={d.linkId} loadId={load.id} papel={d} can={can} />
              ))}
            </ul>
          )}
        </section>

        <Link href={`/loads/${load.id}`} className="text-sm font-medium text-navy-700 hover:underline">
          {load.number}
        </Link>
      </div>
    </AppLayout>
  )
}

function Fila({ loadId, papel, can }: { loadId: string; papel: Papel; can: { download: boolean } }) {
  const { t } = useI18n()
  const [descolgando, setDescolgando] = useState(false)
  const form = useForm({ reason: '' })

  // El sitio se dice con el nombre de la instalación si lo hay, y con la
  // ciudad si no. Sin ninguno de los dos —una parada a medio dar de alta— se
  // dice al menos si es recogida o entrega: «Parada 2» a secas no ayuda a
  // decidir de qué parada es un comprobante.
  const sitio = (s: NonNullable<Papel['stop']>) =>
    s.name || [s.city, s.state].filter(Boolean).join(', ') ||
    t(`loads.documents.stop${s.type === 'pickup' ? 'Pickup' : 'Delivery'}`)

  const lugar = papel.stop === null
    ? t('loads.documents.wholeLoad')
    : t('loads.documents.forStop', { n: papel.stop.sequence, place: sitio(papel.stop) })

  return (
    <li className="border-l-2 border-steel-200 pl-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-carbon">
          <span className="rounded bg-steel-100 px-2 py-0.5 text-xs font-medium text-steel-700">
            {t(`documents.types.${papel.type}`)}
          </span>
          <span className="ml-2">{papel.title}</span>
        </p>
        <p className="text-xs text-steel-600">{lugar}</p>
      </div>

      <p className="mt-0.5 text-xs text-steel-600">
        {t('loads.documents.attachedAt', { date: papel.attachedAt.slice(0, 16) })}
        {papel.byteSize !== null ? ` · ${peso(papel.byteSize)}` : ''}
        {papel.malwareScanStatus === 'pending' ? ` · ${t('loads.documents.scanPending')}` : ''}
      </p>

      <div className="mt-1 flex flex-wrap gap-3">
        {can.download ? (
          <a
            href={`/documents/${papel.documentId}/download`}
            className="text-sm font-medium text-navy-700 hover:underline"
          >
            {t('loads.documents.download')}
          </a>
        ) : null}

        <button
          type="button"
          onClick={() => setDescolgando((v) => !v)}
          className="text-sm font-medium text-danger-700 hover:underline"
        >
          {t('loads.documents.detach')}
        </button>
      </div>

      {descolgando ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            form.delete(`/loads/${loadId}/documents/${papel.linkId}`, { preserveScroll: true })
          }}
          className="mt-2 flex flex-col gap-2 rounded border border-steel-200 bg-steel-50 p-3"
        >
          <p className="text-xs text-steel-700">{t('loads.documents.detachHint')}</p>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('loads.documents.detachReason')}</span>
            <input
              type="text"
              value={form.data.reason}
              onChange={(e) => form.setData('reason', e.target.value)}
              className="rounded border border-steel-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={form.processing}
              className="rounded bg-danger-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-danger-800 disabled:opacity-50"
            >
              {t('loads.documents.detach')}
            </button>
            <button
              type="button"
              onClick={() => setDescolgando(false)}
              className="rounded border border-steel-300 px-4 py-2 text-sm text-steel-700 transition hover:bg-white"
            >
              {t('common.actions.cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </li>
  )
}

function Subir({ loadId, stops, types, mb }: { loadId: string; stops: Stop[]; types: string[]; mb: number }) {
  const { t } = useI18n()
  const form = useForm<{ file: File | null; document_type: string; stop_id: string; title: string }>({
    file: null,
    document_type: types[0] ?? '',
    stop_id: '',
    title: '',
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        // `forceFormData` porque va un fichero: sin él Inertia manda JSON y el
        // fichero se queda en el navegador.
        form.post(`/loads/${loadId}/documents`, {
          forceFormData: true,
          preserveScroll: true,
          onSuccess: () => form.reset(),
        })
      }}
      className="rounded border border-steel-200 bg-white p-4"
    >
      <p className="text-sm font-semibold text-carbon">{t('loads.documents.uploadTitle')}</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-steel-700">{t('loads.documents.typeLabel')}</span>
          <select
            value={form.data.document_type}
            onChange={(e) => form.setData('document_type', e.target.value)}
            className="rounded border border-steel-300 px-3 py-2 text-sm"
          >
            {types.map((tipo) => (
              <option key={tipo} value={tipo}>{t(`documents.types.${tipo}`)}</option>
            ))}
          </select>
          {form.errors.document_type ? (
            <span role="alert" className="text-sm text-danger-700">{form.errors.document_type}</span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-steel-700">{t('loads.documents.stopLabel')}</span>
          <select
            value={form.data.stop_id}
            onChange={(e) => form.setData('stop_id', e.target.value)}
            className="rounded border border-steel-300 px-3 py-2 text-sm"
          >
            <option value="">{t('loads.documents.noStop')}</option>
            {stops.map((s) => (
              <option key={s.id} value={s.id}>
                {t('loads.documents.stopOption', {
                  n: s.sequence,
                  place: s.name ?? ([s.city, s.state].filter(Boolean).join(', ') || t(`loads.documents.stop${s.type === 'pickup' ? 'Pickup' : 'Delivery'}`)),
                })}
              </option>
            ))}
          </select>
          <span className="text-xs text-steel-600">{t('loads.documents.stopHint')}</span>
          {form.errors.stop_id ? (
            <span role="alert" className="text-sm text-danger-700">{form.errors.stop_id}</span>
          ) : null}
        </label>
      </div>

      <label className="mt-4 flex flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('loads.documents.titleLabel')}</span>
        <input
          type="text"
          value={form.data.title}
          onChange={(e) => form.setData('title', e.target.value)}
          className="rounded border border-steel-300 px-3 py-2 text-sm"
        />
      </label>

      <div className="mt-4">
        <span className="text-xs font-medium text-steel-700">{t('loads.documents.fileLabel')}</span>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.tif,.tiff"
          onChange={(e) => form.setData('file', e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm text-steel-700 file:mr-3 file:rounded file:border-0 file:bg-navy-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-navy-800"
        />
        <p className="mt-1 text-xs text-steel-600">{t('loads.documents.fileHint', { mb })}</p>
        {form.errors.file ? (
          <p role="alert" className="mt-1 text-sm text-danger-700">{form.errors.file}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={form.processing || form.data.file === null}
        className="mt-4 rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
      >
        {t('loads.documents.upload')}
      </button>
    </form>
  )
}

function peso(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
