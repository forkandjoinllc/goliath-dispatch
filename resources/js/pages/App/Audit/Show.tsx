import { Link } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

type Valor = string | number | boolean | null

interface Sibling {
  id: string
  occurredAt: string
  action: string
  entityType: string | null
  entityLabel: string | null
  actorName: string | null
  actorEmail: string | null
  reason: string | null
}

interface Props {
  event: {
    id: string
    occurredAt: string
    action: string
    entityType: string | null
    entityId: string | null
    entityLabel: string | null
    actorName: string | null
    actorEmail: string | null
    actorRole: string | null
    reason: string | null
    impersonated: boolean
    before: Record<string, Valor> | null
    after: Record<string, Valor> | null
    ipAddress: string | null
    userAgent: string | null
    requestId: string | null
    effectiveUserName: string | null
  }
  siblings: Sibling[]
}

export default function AuditShow({ event, siblings }: Props) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t(`audit.action.${event.action}`)}
      description={t('audit.show.title')}
      crumbs={[
        { label: t('audit.index.title'), href: '/audit' },
        { label: t('audit.show.title') },
      ]}
    >
      <div className="flex flex-col gap-4">
        {event.impersonated ? (
          <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">{t('audit.show.impersonation')}</p>
            <p className="mt-1">{t('audit.show.impersonationHint')}</p>
            {event.effectiveUserName ? (
              <p className="mt-1">{t('audit.show.actingAs', { name: event.effectiveUserName })}</p>
            ) : null}
          </div>
        ) : null}

        <div className="rounded border border-steel-200 bg-white p-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Dato label={t('audit.show.occurredAt')} value={event.occurredAt.slice(0, 19).replace('T', ' ')} />
            <Dato
              label={t('audit.show.actor')}
              value={[event.actorName, event.actorEmail].filter(Boolean).join(' · ') || t('audit.index.unknownActor')}
            />
            <Dato
              label={t('audit.show.role')}
              value={event.actorRole ? t(`users.roles.${event.actorRole}`) : '—'}
            />
            <Dato
              label={t('audit.show.record')}
              value={
                event.entityType
                  ? [t(`audit.entity.${event.entityType}`), event.entityLabel].filter(Boolean).join(' · ')
                  : '—'
              }
            />
            <Dato label={t('audit.show.recordId')} value={event.entityId ?? '—'} mono />
            <Dato label={t('audit.show.ipAddress')} value={event.ipAddress ?? '—'} mono />
            <Dato label={t('audit.show.requestId')} value={event.requestId ?? '—'} mono />
            <Dato label={t('audit.show.userAgent')} value={event.userAgent ?? '—'} />
          </dl>

          <div className="mt-4 border-t border-steel-100 pt-3">
            <p className="text-xs uppercase tracking-wide text-steel-600">{t('audit.show.reason')}</p>
            <p className="mt-1 text-sm text-carbon">
              {event.reason ?? <span className="text-steel-500">{t('audit.show.noReason')}</span>}
            </p>
          </div>
        </div>

        <Cambios before={event.before} after={event.after} />

        {siblings.length > 0 ? (
          <div className="rounded border border-steel-200 bg-white p-4">
            <p className="text-sm font-semibold text-carbon">{t('audit.show.siblings')}</p>
            <p className="mt-0.5 text-xs text-steel-600">{t('audit.show.siblingsHint')}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {siblings.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="tabular-nums text-steel-600">{s.occurredAt.slice(11, 19)}</span>
                  <Link href={`/audit/${s.id}`} className="text-navy-700 underline">
                    {t(`audit.action.${s.action}`)}
                  </Link>
                  {s.entityLabel ? <span className="text-steel-700">{s.entityLabel}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs text-steel-600">{t('audit.show.appendOnly')}</p>

        <div>
          <Link href="/audit" className="text-sm text-navy-700 underline">
            {t('audit.show.back')}
          </Link>
        </div>
      </div>
    </AppLayout>
  )
}

/**
 * El antes y el después, campo a campo.
 *
 * Se unen las claves de los dos resúmenes en vez de recorrer solo uno: un campo
 * que aparece al crear no está en el «antes», y uno que se limpia no está en el
 * «después». Recorriendo uno solo, la mitad de los cambios no se verían.
 */
function Cambios({
  before,
  after,
}: {
  before: Record<string, Valor> | null
  after: Record<string, Valor> | null
}) {
  const { t } = useI18n()

  const claves = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort()

  if (claves.length === 0) {
    return (
      <div className="rounded border border-steel-200 bg-white p-4">
        <p className="text-sm font-semibold text-carbon">{t('audit.show.changes')}</p>
        <p className="mt-1 text-sm text-steel-600">{t('audit.show.noChanges')}</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded border border-steel-200 bg-white">
      <p className="px-4 pt-4 text-sm font-semibold text-carbon">{t('audit.show.changes')}</p>
      <table className="mt-3 w-full text-left text-sm">
        <thead className="bg-steel-50 text-xs uppercase tracking-wide text-steel-600">
          <tr>
            <th className="px-4 py-2.5 font-medium">{t('audit.show.field')}</th>
            <th className="px-4 py-2.5 font-medium">{t('audit.show.before')}</th>
            <th className="px-4 py-2.5 font-medium">{t('audit.show.after')}</th>
          </tr>
        </thead>
        <tbody>
          {claves.map((clave) => {
            const antes = before?.[clave]
            const despues = after?.[clave]
            const cambio = texto(antes) !== texto(despues)

            return (
              <tr key={clave} className="border-t border-steel-100">
                <td className="px-4 py-2.5 font-mono text-xs text-steel-700">{clave}</td>
                <td className="px-4 py-2.5 text-steel-600">{pinta(antes, t)}</td>
                <td className={`px-4 py-2.5 ${cambio ? 'font-medium text-carbon' : 'text-steel-600'}`}>
                  {pinta(despues, t)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function texto(v: Valor | undefined): string {
  if (v === undefined || v === null) return ''
  return String(v)
}

function pinta(v: Valor | undefined, t: (key: string) => string) {
  const s = texto(v)
  return s === '' ? <span className="text-steel-400">{t('audit.show.empty')}</span> : s
}

function Dato({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-steel-600">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-carbon ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  )
}
