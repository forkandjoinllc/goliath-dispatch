import { Link, useForm, router } from '@inertiajs/react'
import { useRef } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import { textoDeSistema } from '@/pages/App/Messages/Index'

interface Attachment {
  id: string
  filename: string
  contentType: string
  byteSize: number
}

interface Msg {
  id: string
  origin: string
  body: string
  systemKey: string | null
  systemParams: Record<string, string> | null
  createdAt: string
  editedAt: string | null
  senderUserId: string | null
  sender: string | null
  attachments: Attachment[]
}

interface Participant {
  userId: string
  role: string
  name: string
  lastReadAt: string | null
}

interface Props {
  thread: {
    id: string
    subject: string | null
    kind: string
    isOperational: boolean
    loadId: string | null
    loadNumber: string | null
  }
  messages: Msg[]
  participants: Participant[]
  carrierMissing: string | null
  me: string
  maxKb: number
  can: { send: boolean }
}

/**
 * Un hilo.
 *
 * Lo que hay que mirar aquí son los mensajes de sistema: no se pinta su `body`,
 * se traduce su clave. El `body` quedó redactado en el idioma de quien provocó
 * el cambio; la clave se traduce al de quien está leyendo. En un hilo de carga
 * hay despacho en español y un transportista que puede trabajar en inglés, y
 * ese es el motivo entero de que el esquema guarde clave y parámetros.
 *
 * La lista de participantes está arriba y no escondida a propósito. La regla es
 * que un hilo se ve desde dentro, también para el administrador — y una regla
 * así solo vale si en todo momento se ve QUIÉN está dentro.
 */
export default function MessageThreadPage({ thread, messages, participants, carrierMissing, me, maxKb, can }: Props) {
  const { t } = useI18n()
  const mb = Math.floor(maxKb / 1024)

  return (
    <AppLayout
      title={t('messages.show.title')}
      heading={thread.loadNumber ?? thread.subject ?? t('messages.show.title')}
      crumbs={[
        { label: t('messages.index.title'), href: '/messages' },
        { label: thread.loadNumber ?? thread.subject ?? t('messages.show.title') },
      ]}
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-wrap items-center gap-3 rounded border border-steel-200 bg-white p-4">
          <span className="rounded bg-steel-100 px-2 py-0.5 text-xs font-medium text-steel-700">
            {t(`messages.kind.${thread.kind}`)}
          </span>

          {thread.isOperational ? (
            <span
              title={t('messages.show.operationalHint')}
              className="rounded bg-safety-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-safety-800"
            >
              {t('messages.show.operational')}
            </span>
          ) : null}

          {thread.loadId !== null ? (
            <Link href={`/loads/${thread.loadId}`} className="text-sm font-medium text-navy-700 hover:underline">
              {t('messages.index.openLoad')}
            </Link>
          ) : null}
        </section>

        {/*
          Un hilo con un solo lado es el fallo que este módulo viene a arreglar,
          otra vez. Se dice arriba y en voz alta: la única señal alternativa
          sería que la lista de participantes es corta, y eso es pedirle a
          alguien que note una ausencia.
        */}
        {carrierMissing !== null ? (
          <section className="rounded border border-warning-300 bg-warning-50 p-3">
            <p className="text-sm font-semibold text-carbon">
              {t('messages.show.carrierMissingTitle', { carrier: carrierMissing })}
            </p>
            <p className="mt-0.5 text-sm text-carbon">{t('messages.show.carrierMissingHint')}</p>
          </section>
        ) : null}

        <Participantes hilo={thread.id} participantes={participants} me={me} />

        <section className="rounded border border-steel-200 bg-white p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-steel-600">{t('messages.show.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {messages.map((m) => <Burbuja key={m.id} m={m} me={me} />)}
            </ul>
          )}
        </section>

        {can.send ? <Escribir hilo={thread.id} mb={mb} /> : null}
      </div>
    </AppLayout>
  )
}

function Burbuja({ m, me }: { m: Msg; me: string }) {
  const { t } = useI18n()

  if (m.origin === 'system' && m.systemKey !== null) {
    return (
      <li className="border-l-2 border-steel-300 pl-3">
        <p className="text-sm italic text-steel-600">
          {textoDeSistema(t, m.systemKey, m.systemParams)}
        </p>
        <p className="text-xs text-steel-500">{m.createdAt.slice(0, 16)}</p>
      </li>
    )
  }

  const mio = m.senderUserId === me

  return (
    <li className={`border-l-2 pl-3 ${mio ? 'border-navy-600' : 'border-steel-200'}`}>
      <p className="text-xs text-steel-600">
        <span className="font-medium text-carbon">{m.sender ?? '—'}</span>
        <span className="ml-2">{m.createdAt.slice(0, 16)}</span>
        {m.editedAt !== null ? <span className="ml-2 italic">{t('messages.show.edited')}</span> : null}
      </p>

      <p className="mt-0.5 whitespace-pre-wrap text-sm text-carbon">{m.body}</p>

      {m.attachments.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-3">
          {m.attachments.map((a) => (
            <li key={a.id} className="text-xs text-steel-600">
              <span className="font-medium text-carbon">{a.filename}</span>
              <span className="ml-1">{peso(a.byteSize)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function Participantes({ hilo, participantes, me }: { hilo: string; participantes: Participant[]; me: string }) {
  const { t } = useI18n()

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <p className="text-sm font-semibold text-carbon">{t('messages.show.participants')}</p>
      <p className="mt-0.5 text-xs text-steel-600">{t('messages.show.participantsHint')}</p>

      <ul className="mt-3 flex flex-col gap-2">
        {participantes.map((p) => (
          <li key={p.userId} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-carbon">
              {p.name}
              <span className="ml-2 text-xs text-steel-600">{t(`nav.roles.${p.role}`)}</span>
            </span>

            <span className="flex items-center gap-3 text-xs text-steel-600">
              {p.lastReadAt === null
                ? t('messages.show.neverRead')
                : t('messages.show.lastRead', { date: p.lastReadAt })}

              <button
                type="button"
                onClick={() => router.delete(`/messages/${hilo}/participants/${p.userId}`, { preserveScroll: true })}
                className="font-medium text-danger-700 hover:underline"
              >
                {p.userId === me ? t('messages.show.leave') : t('messages.show.remove')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Escribir({ hilo, mb }: { hilo: string; mb: number }) {
  const { t } = useI18n()
  const fichero = useRef<HTMLInputElement>(null)
  const form = useForm<{ body: string; file: File | null }>({ body: '', file: null })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        // `forceFormData` porque puede ir un fichero: sin él Inertia manda JSON
        // y el adjunto se queda en el navegador.
        form.post(`/messages/${hilo}`, {
          forceFormData: true,
          preserveScroll: true,
          onSuccess: () => {
            form.reset()
            if (fichero.current !== null) fichero.current.value = ''
          },
        })
      }}
      className="rounded border border-steel-200 bg-white p-4"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('messages.compose.label')}</span>
        <textarea
          rows={3}
          value={form.data.body}
          placeholder={t('messages.compose.placeholder')}
          onChange={(e) => form.setData('body', e.target.value)}
          className="rounded border border-steel-300 px-3 py-2 text-sm"
        />
      </label>
      {form.errors.body ? (
        <p role="alert" className="mt-1 text-sm text-danger-700">{form.errors.body}</p>
      ) : null}

      <div className="mt-3">
        <span className="text-xs font-medium text-steel-700">{t('messages.compose.attach')}</span>
        <input
          ref={fichero}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.tif,.tiff"
          onChange={(e) => form.setData('file', e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm text-steel-700 file:mr-3 file:rounded file:border-0 file:bg-navy-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-navy-800"
        />
        <p className="mt-1 text-xs text-steel-600">{t('messages.compose.attachHint', { mb })}</p>
        {form.errors.file ? (
          <p role="alert" className="mt-1 text-sm text-danger-700">{form.errors.file}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={form.processing || form.data.body.trim() === ''}
        className="mt-3 rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
      >
        {t('messages.compose.send')}
      </button>
    </form>
  )
}

function peso(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
