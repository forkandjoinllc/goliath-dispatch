import { Link, useForm } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Row {
  id: string
  status: string
  title: string
  templateKey: string
  templateVersion: number
  signerEmail: string
  signerLegalName: string | null
  locale: string
  subjectType: string
  carrierName: string | null
  requestedAt: string | null
  firstViewedAt: string | null
  completedAt: string | null
  expiresAt: string | null
}

interface Props {
  requests: Row[]
  needsResignature: Row[]
  filters: { status: string }
  statuses: string[]
  newSigningUrl: string | null
  carriers: { id: string; name: string }[]
  templates: { key: string; title: string }[]
  can: { create: boolean; void: boolean; templates: boolean }
}

/**
 * Las solicitudes de firma.
 *
 * La sección de «requiere nueva firma» no es un filtro más: son firmas VÁLIDAS
 * —lo siguen siendo para el texto que se firmó— sobre una versión de plantilla
 * que la casa ya retiró. Ponerlas junto a las vencidas o las rechazadas diría
 * que algo salió mal, y no salió mal: la casa cambió de acuerdo.
 */
export default function SignaturesIndex({
  requests, needsResignature, filters, statuses, newSigningUrl, carriers, templates, can,
}: Props) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t('signature.index.title')}
      description={t('signature.index.description')}
      crumbs={[{ label: t('signature.index.title') }]}
      actions={
        can.templates ? (
          <Link
            href="/signatures/templates"
            className="rounded border border-steel-300 bg-white px-3 py-2 text-sm font-medium text-carbon transition hover:bg-steel-50"
          >
            {t('signature.templates.title')}
          </Link>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {newSigningUrl ? (
          <div className="rounded border border-warning-300 bg-warning-50 p-4">
            <p className="text-sm font-semibold text-carbon">{t('signature.index.linkOnce')}</p>
            <p className="mt-2 break-all rounded bg-white px-3 py-2 font-mono text-xs text-carbon">
              {newSigningUrl}
            </p>
          </div>
        ) : null}

        {can.create ? <Enviar carriers={carriers} templates={templates} /> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Filtro activo={filters.status === ''} href="/signatures">
            {t('signature.index.filterAllStatuses')}
          </Filtro>
          {statuses.map((s) => (
            <Filtro key={s} activo={filters.status === s} href={`/signatures?status=${s}`}>
              {t(`signature.statuses.${s}`)}
            </Filtro>
          ))}
        </div>

        <Tabla rows={requests} vacio={t('signature.index.empty')} />

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('signature.index.needsResignature')}</p>
          <p className="mt-0.5 text-xs text-steel-600">
            {t('signature.index.needsResignatureDescription')}
          </p>
          <div className="mt-3">
            <Tabla rows={needsResignature} vacio={t('signature.index.needsResignatureEmpty')} />
          </div>
        </section>
      </div>
    </AppLayout>
  )
}

function Tabla({ rows, vacio }: { rows: Row[]; vacio: string }) {
  const { t } = useI18n()

  if (rows.length === 0) {
    return <p className="text-sm text-steel-600">{vacio}</p>
  }

  return (
    <div className="overflow-x-auto rounded border border-steel-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-steel-50 text-xs uppercase tracking-wide text-steel-600">
          <tr>
            <th className="px-4 py-2.5 font-medium">{t('signature.index.documentColumn')}</th>
            <th className="px-4 py-2.5 font-medium">{t('signature.index.carrierColumn')}</th>
            <th className="px-4 py-2.5 font-medium">{t('signature.index.signerColumn')}</th>
            <th className="px-4 py-2.5 font-medium">{t('signature.fields.status')}</th>
            <th className="px-4 py-2.5 font-medium">{t('signature.index.sentColumn')}</th>
            <th className="px-4 py-2.5 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-steel-100">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2.5">
                <span className="text-carbon">{r.title}</span>
                <span className="ml-2 text-xs text-steel-600">
                  {t('signature.fields.templateVersion', { version: String(r.templateVersion) })}
                </span>
              </td>
              <td className="px-4 py-2.5 text-steel-700">{r.carrierName ?? '—'}</td>
              <td className="px-4 py-2.5 text-steel-700">
                {r.signerLegalName ?? r.signerEmail}
              </td>
              <td className="px-4 py-2.5">
                <Estado status={r.status} />
              </td>
              <td className="px-4 py-2.5 text-steel-700">{r.requestedAt ?? '—'}</td>
              <td className="px-4 py-2.5 text-right">
                <Link href={`/signatures/${r.id}`} className="text-sm font-medium text-navy-700 hover:underline">
                  {t('signature.index.open')}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Estado({ status }: { status: string }) {
  const { t } = useI18n()

  const tono: Record<string, string> = {
    pending: 'bg-steel-100 text-steel-700',
    viewed: 'bg-navy-50 text-navy-700',
    signed: 'bg-success-50 text-success-700',
    declined: 'bg-danger-50 text-danger-700',
    expired: 'bg-steel-100 text-steel-600',
    voided: 'bg-steel-100 text-steel-600',
    superseded: 'bg-warning-50 text-warning-700',
  }

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tono[status] ?? 'bg-steel-100 text-steel-700'}`}>
      {t(`signature.statuses.${status}`)}
    </span>
  )
}

function Enviar({
  carriers, templates,
}: { carriers: { id: string; name: string }[]; templates: { key: string; title: string }[] }) {
  const { t } = useI18n()
  const form = useForm({
    carrier_id: '',
    template_key: '',
    signer_email: '',
    signer_legal_name: '',
    locale: 'en',
    expiry_days: '30',
  })

  if (templates.length === 0) {
    return (
      <p className="rounded border border-dashed border-steel-300 p-3 text-sm text-steel-700">
        {t('signature.sendDialog.noTemplatesAvailable')}
      </p>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.transform((d) => ({ ...d, expiry_days: Number(d.expiry_days || 0) }))
        form.post('/signatures/requests', { preserveScroll: true, onSuccess: () => form.reset() })
      }}
      className="flex flex-wrap items-end gap-3 rounded border border-steel-200 bg-white p-4"
    >
      <p className="w-full text-sm font-semibold text-carbon">{t('signature.index.sendForSignature')}</p>
      <p className="w-full text-xs text-steel-600">{t('signature.sendDialog.description')}</p>

      <label className="flex min-w-56 flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('signature.sendDialog.carrier')}</span>
        <select
          value={form.data.carrier_id}
          onChange={(e) => form.setData('carrier_id', e.target.value)}
          className={CAMPO}
        >
          <option value="">{t('signature.sendDialog.selectCarrierPlaceholder')}</option>
          {carriers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      <label className="flex min-w-56 flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('signature.sendDialog.template')}</span>
        <select
          value={form.data.template_key}
          onChange={(e) => form.setData('template_key', e.target.value)}
          className={CAMPO}
        >
          <option value="">{t('signature.sendDialog.selectTemplatePlaceholder')}</option>
          {templates.map((p) => (
            <option key={p.key} value={p.key}>{p.title}</option>
          ))}
        </select>
      </label>

      <label className="flex min-w-56 flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('signature.sendDialog.signerEmail')}</span>
        <input
          type="email"
          value={form.data.signer_email}
          onChange={(e) => form.setData('signer_email', e.target.value)}
          className={CAMPO}
        />
      </label>

      <label className="flex min-w-48 flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('signature.sendDialog.signerName')}</span>
        <input
          type="text"
          value={form.data.signer_legal_name}
          onChange={(e) => form.setData('signer_legal_name', e.target.value)}
          className={CAMPO}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('signature.sendDialog.locale')}</span>
        <select
          value={form.data.locale}
          onChange={(e) => form.setData('locale', e.target.value)}
          className={CAMPO}
        >
          <option value="en">{t('signature.sendDialog.localeOptions.en')}</option>
          <option value="es">{t('signature.sendDialog.localeOptions.es')}</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('signature.sendDialog.expiresInDays')}</span>
        <input
          type="number"
          min="0"
          max="365"
          value={form.data.expiry_days}
          onChange={(e) => form.setData('expiry_days', e.target.value)}
          className={`${CAMPO} w-28`}
        />
        <span className="text-[11px] text-steel-500">{t('signature.sendDialog.expiryHint')}</span>
      </label>

      <button
        type="submit"
        disabled={form.processing}
        className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
      >
        {t('signature.sendDialog.submit')}
      </button>
    </form>
  )
}

function Filtro({ activo, href, children }: { activo: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded border px-3 py-1.5 text-sm transition ${
        activo
          ? 'border-navy-600 bg-navy-50 font-medium text-navy-800'
          : 'border-steel-300 bg-white text-steel-700 hover:bg-steel-50'
      }`}
    >
      {children}
    </Link>
  )
}

const CAMPO =
  'rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'
