import { Link, router, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { Pager, type PageMeta } from '@/components/App/Pager'
import { useI18n } from '@/lib/i18n'

interface Row {
  id: string
  eventKey: string
  title: string
  body: string
  actionUrl: string | null
  readAt: string | null
  createdAt: string
}

interface Preference {
  eventKey: string
  inApp: boolean
  email: boolean
}

interface Props {
  notifications: { data: Row[]; meta: PageMeta }
  filters: { unread: string }
  events: string[]
  preferences: Preference[]
}

/**
 * Los avisos de quien mira.
 *
 * El texto viene YA COMPUESTO del servidor, en el idioma de esta persona y con
 * los nombres dentro. No se traduce aquí a propósito: un aviso es un hecho
 * ocurrido en un momento, y volver a componerlo hoy con el diccionario de hoy
 * podría contar algo distinto de lo que se le mandó.
 */
export default function NotificationsIndex({ notifications, filters, events, preferences }: Props) {
  const { t } = useI18n()
  const [verPreferencias, setVerPreferencias] = useState(false)

  const soloSinLeer = filters.unread === '1'

  const marcarTodos = () =>
    router.post('/notifications/read-all', {}, { preserveScroll: true })

  return (
    <AppLayout
      title={t('notifications.index.title')}
      description={t('notifications.index.subtitle')}
      crumbs={[{ label: t('notifications.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded border border-steel-300">
            <Filtro activo={!soloSinLeer} href="/notifications">{t('notifications.index.all')}</Filtro>
            <Filtro activo={soloSinLeer} href="/notifications?unread=1">
              {t('notifications.index.unreadOnly')}
            </Filtro>
          </div>

          <button
            type="button"
            onClick={marcarTodos}
            className="rounded border border-steel-300 px-3 py-1.5 text-sm text-navy-700 transition hover:bg-navy-50"
          >
            {t('notifications.index.markAllRead')}
          </button>

          <button
            type="button"
            onClick={() => setVerPreferencias((v) => !v)}
            aria-expanded={verPreferencias}
            className="ml-auto text-sm text-navy-700 underline"
          >
            {t('notifications.preferences.title')}
          </button>
        </div>

        {verPreferencias ? <Preferencias events={events} preferences={preferences} /> : null}

        {notifications.data.length === 0 ? (
          <p className="rounded border border-dashed border-steel-300 bg-white p-8 text-center text-sm text-steel-600">
            {soloSinLeer ? t('notifications.index.emptyUnread') : t('notifications.index.empty')}
          </p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {notifications.data.map((n) => (
            <li
              key={n.id}
              className={`rounded border p-4 ${
                n.readAt === null ? 'border-navy-200 bg-navy-50' : 'border-steel-200 bg-white'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-carbon">{n.title}</p>
                  <p className="mt-0.5 text-sm text-steel-700">{n.body}</p>
                  <p className="mt-1 text-xs text-steel-600">
                    {n.createdAt.replace('T', ' ')}
                    {' · '}
                    {t(`notifications.eventNames.${n.eventKey}`)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {n.actionUrl ? (
                    <Link href={n.actionUrl} className="text-sm text-navy-700 underline">
                      {t('notifications.index.open')}
                    </Link>
                  ) : null}

                  {n.readAt === null ? (
                    <button
                      type="button"
                      onClick={() =>
                        router.post(`/notifications/${n.id}/read`, {}, { preserveScroll: true })
                      }
                      className="text-sm text-steel-600 underline"
                    >
                      {t('notifications.index.markRead')}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <Pager meta={notifications.meta} path="/notifications" params={{ ...filters }} />
      </div>
    </AppLayout>
  )
}

function Preferencias({ events, preferences }: { events: string[]; preferences: Preference[] }) {
  const { t } = useI18n()

  const form = useForm({
    preferences: events.map((evento) => {
      const guardada = preferences.find((p) => p.eventKey === evento)

      return {
        event_key: evento,
        in_app: guardada?.inApp ?? true,
        email: guardada?.email ?? true,
      }
    }),
  })

  const cambiar = (i: number, campo: 'in_app' | 'email', valor: boolean) =>
    form.setData(
      'preferences',
      form.data.preferences.map((p, j) => (i === j ? { ...p, [campo]: valor } : p)),
    )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.post('/notification-preferences', { preserveScroll: true })
      }}
      className="rounded border border-steel-200 bg-white p-4"
    >
      <p className="text-sm font-semibold text-carbon">{t('notifications.preferences.title')}</p>
      <p className="mt-0.5 text-xs text-steel-600">{t('notifications.preferences.hint')}</p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-steel-600">
            <tr>
              <th className="py-2 font-medium" />
              <th className="px-4 py-2 font-medium">{t('notifications.preferences.inApp')}</th>
              <th className="px-4 py-2 font-medium">{t('notifications.preferences.email')}</th>
            </tr>
          </thead>
          <tbody>
            {form.data.preferences.map((p, i) => (
              <tr key={p.event_key} className="border-t border-steel-100">
                <td className="py-2.5">{t(`notifications.eventNames.${p.event_key}`)}</td>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={p.in_app}
                    onChange={(e) => cambiar(i, 'in_app', e.target.checked)}
                    aria-label={`${t('notifications.preferences.inApp')} — ${t(`notifications.eventNames.${p.event_key}`)}`}
                    className="h-4 w-4"
                  />
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={p.email}
                    onChange={(e) => cambiar(i, 'email', e.target.checked)}
                    aria-label={`${t('notifications.preferences.email')} — ${t(`notifications.eventNames.${p.event_key}`)}`}
                    className="h-4 w-4"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="submit"
        disabled={form.processing}
        className="mt-3 rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
      >
        {t('notifications.preferences.save')}
      </button>
    </form>
  )
}

function Filtro({
  activo,
  href,
  children,
}: {
  activo: boolean
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      preserveScroll
      className={`px-3 py-1.5 text-sm transition ${
        activo ? 'bg-navy-700 font-semibold text-white' : 'text-navy-700 hover:bg-navy-50'
      }`}
    >
      {children}
    </Link>
  )
}
