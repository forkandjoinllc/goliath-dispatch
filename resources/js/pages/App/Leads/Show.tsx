import { Link, useForm } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Quote {
  id: string
  commodity: string | null
  weightPounds: number | null
  lengthInches: number | null
  widthInches: number | null
  heightInches: number | null
  origin: string
  destination: string
  readyDate: string | null
  equipmentPreference: string | null
  oversizeSuspected: boolean
  notes: string | null
  createdOn: string
}

interface Props {
  lead: {
    id: string
    name: string
    firstName: string
    lastName: string
    email: string
    phone: string | null
    companyName: string | null
    dotNumber: string | null
    mcNumber: string | null
    status: string
    source: string
    assignedToId: string | null
    assignedToName: string | null
    createdAt: string
    message: string | null
    sourcePath: string | null
    utm: Record<string, string> | null
    ipAddress: string | null
    locale: string
  }
  quotes: Quote[]
  matches: {
    customers: { id: string; name: string }[]
    carriers: { id: string; name: string }[]
  }
  statuses: string[]
  assignees: { id: string; name: string; email: string }[]
  can: { update: boolean; createCustomer: boolean }
}

export default function LeadShow({ lead, quotes, matches, statuses, assignees, can }: Props) {
  const { t } = useI18n()

  const estado = useForm({ status: lead.status, reason: '' })
  const responsable = useForm({ assigned_to_user_id: lead.assignedToId ?? '' })

  const hayCoincidencias = matches.customers.length > 0 || matches.carriers.length > 0

  return (
    <AppLayout
      title={lead.name}
      description={t('leads.show.title')}
      crumbs={[
        { label: t('leads.index.title'), href: '/leads' },
        { label: lead.name },
      ]}
    >
      <div className="flex flex-col gap-4">
        <div className="rounded border border-steel-200 bg-white p-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Dato label={t('leads.show.email')} value={lead.email} />
            <Dato label={t('leads.show.phone')} value={lead.phone ?? '—'} />
            <Dato label={t('leads.show.company')} value={lead.companyName ?? '—'} />
            <Dato label={t('leads.show.source')} value={t(`leads.source.${lead.source}`)} />
            {lead.dotNumber ? <Dato label={t('leads.show.dotNumber')} value={lead.dotNumber} /> : null}
            {lead.mcNumber ? <Dato label={t('leads.show.mcNumber')} value={lead.mcNumber} /> : null}
            <Dato label={t('leads.show.receivedAt')} value={lead.createdAt.replace('T', ' ')} />
            <Dato label={t('leads.show.language')} value={lead.locale.toUpperCase()} />
            {lead.sourcePath ? <Dato label={t('leads.show.sourcePath')} value={lead.sourcePath} mono /> : null}
            {lead.ipAddress ? <Dato label={t('leads.show.ipAddress')} value={lead.ipAddress} mono /> : null}
          </dl>

          <div className="mt-4 border-t border-steel-100 pt-3">
            <p className="text-xs uppercase tracking-wide text-steel-600">{t('leads.show.message')}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-carbon">
              {lead.message ?? <span className="text-steel-500">{t('leads.show.noMessage')}</span>}
            </p>
          </div>

          <div className="mt-4 border-t border-steel-100 pt-3">
            <p className="text-xs uppercase tracking-wide text-steel-600">{t('leads.show.campaign')}</p>
            {lead.utm ? (
              <ul className="mt-1 flex flex-wrap gap-3 text-sm text-steel-700">
                {Object.entries(lead.utm).map(([k, v]) => (
                  <li key={k}>
                    <span className="font-mono text-xs text-steel-600">{k}</span> {String(v)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-steel-500">{t('leads.show.noCampaign')}</p>
            )}
          </div>
        </div>

        {/* Trabajar el prospecto */}
        <div className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('leads.show.work')}</p>

          {can.update ? (
            <div className="mt-3 flex flex-col gap-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  estado.post(`/leads/${lead.id}/status`, { preserveScroll: true })
                }}
                className="flex flex-wrap items-end gap-3"
              >
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-steel-700">{t('leads.show.changeStatus')}</span>
                  <select
                    value={estado.data.status}
                    onChange={(e) => estado.setData('status', e.target.value)}
                    className={CAMPO}
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>{t(`leads.status.${s}`)}</option>
                    ))}
                  </select>
                </label>

                {/* El motivo solo aparece al perderlo: es la única salida que
                    cierra la conversación, y sin el porqué el embudo no cuenta
                    más que un número que baja. */}
                {estado.data.status === 'lost' ? (
                  <label className="flex min-w-64 flex-1 flex-col gap-1">
                    <span className="text-xs font-medium text-steel-700">{t('leads.show.reason')}</span>
                    <input
                      type="text"
                      value={estado.data.reason}
                      onChange={(e) => estado.setData('reason', e.target.value)}
                      className={CAMPO}
                    />
                    <span className="text-xs text-steel-600">{t('leads.show.reasonWhenLost')}</span>
                  </label>
                ) : null}

                <button
                  type="submit"
                  disabled={estado.processing}
                  className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
                >
                  {t('leads.show.save')}
                </button>

                {estado.errors.status ? (
                  <p role="alert" className="w-full text-sm text-danger-700">{estado.errors.status}</p>
                ) : null}
                {estado.errors.reason ? (
                  <p role="alert" className="w-full text-sm text-danger-700">{estado.errors.reason}</p>
                ) : null}
              </form>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  responsable.post(`/leads/${lead.id}/assign`, { preserveScroll: true })
                }}
                className="flex flex-wrap items-end gap-3 border-t border-steel-100 pt-4"
              >
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-steel-700">{t('leads.show.assignTo')}</span>
                  <select
                    value={responsable.data.assigned_to_user_id}
                    onChange={(e) => responsable.setData('assigned_to_user_id', e.target.value)}
                    className={CAMPO}
                  >
                    <option value="">{t('leads.index.unassigned')}</option>
                    {assignees.map((a) => (
                      <option key={a.id} value={a.id}>{a.name || a.email}</option>
                    ))}
                  </select>
                </label>

                <button
                  type="submit"
                  disabled={responsable.processing}
                  className="rounded border border-steel-300 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50 disabled:opacity-50"
                >
                  {t('leads.show.assign')}
                </button>
              </form>
            </div>
          ) : (
            <p className="mt-1 text-sm text-steel-600">{t('leads.show.readOnly')}</p>
          )}
        </div>

        {/* ¿Ya está en la casa? */}
        <div className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('leads.show.matches')}</p>
          <p className="mt-0.5 text-xs text-steel-600">{t('leads.show.matchesHint')}</p>

          {hayCoincidencias ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {matches.customers.length > 0 ? (
                <Lista
                  label={t('leads.show.matchedCustomers')}
                  items={matches.customers}
                  href={(id) => `/customers/${id}`}
                />
              ) : null}
              {matches.carriers.length > 0 ? (
                <Lista
                  label={t('leads.show.matchedCarriers')}
                  items={matches.carriers}
                  href={(id) => `/carriers/${id}`}
                />
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-steel-600">{t('leads.show.noMatches')}</p>
          )}

          {can.createCustomer ? (
            <div className="mt-4 border-t border-steel-100 pt-3">
              <Link
                href={`/customers/create?fromLead=${lead.id}`}
                className="text-sm text-navy-700 underline"
              >
                {t('leads.show.createCustomer')}
              </Link>
              <p className="mt-0.5 text-xs text-steel-600">{t('leads.show.createCustomerHint')}</p>
            </div>
          ) : null}
        </div>

        {/* Presupuestos */}
        <div className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('leads.show.quotes')}</p>
          <p className="mt-0.5 text-xs text-steel-600">{t('leads.show.quotesHint')}</p>

          {quotes.length === 0 ? (
            <p className="mt-3 text-sm text-steel-600">{t('leads.show.noQuotes')}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {quotes.map((q) => (
                <li key={q.id} className="rounded border border-steel-200 p-3">
                  <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    <Dato label={t('leads.show.commodity')} value={q.commodity ?? '—'} />
                    <Dato
                      label={t('leads.show.route')}
                      value={[q.origin, q.destination].filter(Boolean).join(' → ') || '—'}
                    />
                    <Dato
                      label={t('leads.show.weight')}
                      value={
                        q.weightPounds === null
                          ? '—'
                          : t('leads.show.pounds', { n: q.weightPounds.toLocaleString() })
                      }
                    />
                    <Dato label={t('leads.show.dimensions')} value={medidas(q, t)} />
                    <Dato label={t('leads.show.readyDate')} value={q.readyDate ?? '—'} />
                    <Dato label={t('leads.show.equipment')} value={q.equipmentPreference ?? '—'} />
                  </dl>

                  {q.oversizeSuspected ? (
                    <p className="mt-2 inline-block rounded bg-warning-100 px-2 py-0.5 text-xs text-warning-800">
                      {t('leads.show.oversize')}
                    </p>
                  ) : null}

                  {q.notes ? (
                    <p className="mt-2 whitespace-pre-line text-sm text-steel-700">{q.notes}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <Link href="/leads" className="text-sm text-navy-700 underline">
            {t('leads.show.back')}
          </Link>
        </div>
      </div>
    </AppLayout>
  )
}

function medidas(q: Quote, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (q.lengthInches === null && q.widthInches === null && q.heightInches === null) return '—'

  return t('leads.show.inches', {
    l: q.lengthInches ?? '?',
    w: q.widthInches ?? '?',
    h: q.heightInches ?? '?',
  })
}

const CAMPO =
  'rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'

function Lista({
  label,
  items,
  href,
}: {
  label: string
  items: { id: string; name: string }[]
  href: (id: string) => string
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-steel-600">{label}</p>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {items.map((i) => (
          <li key={i.id}>
            <Link href={href(i.id)} className="text-navy-700 underline">{i.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Dato({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-steel-600">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-carbon ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  )
}
