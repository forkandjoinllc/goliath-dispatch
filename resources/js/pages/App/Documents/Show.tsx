import { Link, useForm } from '@inertiajs/react'
import { useState, type ReactNode } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Version {
  id: string
  number: number
  filename: string
  bytes: number
  sha256Prefix: string
  contentType: string
  scanStatus: string
  uploadedAt: string
  uploadedBy: string | null
  isCurrent: boolean
}

interface Props {
  document: {
    id: string
    title: string
    documentType: string
    reviewStatus: string
    isRequired: boolean
    issueDate: string | null
    expirationDate: string | null
    expiryFlag: string | null
    description: string | null
    createdAt: string | null
  }
  owner: { type: string; id: string; name: string; href: string | null }
  versions: Version[]
  reviews: { decision: string; notes: string | null; at: string; by: string | null }[]
  can: { upload: boolean; review: boolean; download: boolean }
}

const REVIEW_TONE: Record<string, string> = {
  approved: 'bg-success-50 text-success-700 ring-success-500/40',
  pending: 'bg-navy-100 text-navy-800 ring-navy-500/30',
  in_review: 'bg-navy-100 text-navy-800 ring-navy-500/30',
  rejected: 'bg-danger-50 text-danger-700 ring-danger-500/40',
  expired: 'bg-danger-50 text-danger-700 ring-danger-500/40',
  superseded: 'bg-steel-100 text-steel-600 ring-steel-300',
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function DocumentShow({ document, owner, versions, reviews, can }: Props) {
  const { t, locale } = useI18n()

  const day = (value: string | null): string =>
    value
      ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { dateStyle: 'medium' }).format(
          new Date(value.length === 10 ? `${value}T00:00:00` : value),
        )
      : '—'

  return (
    <AppLayout
      title={t(`documents.types.${document.documentType}`)}
      crumbs={[
        { label: t('documents.index.title'), href: '/documents' },
        { label: t(`documents.types.${document.documentType}`) },
      ]}
      actions={
        can.download ? (
          <a
            href={`/documents/${document.id}/download`}
            className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
          >
            {t('documents.detail.download')}
          </a>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            REVIEW_TONE[document.reviewStatus] ?? REVIEW_TONE.pending
          }`}
        >
          {t(`documents.review.${document.reviewStatus}`)}
        </span>
        {document.isRequired ? (
          <span className="inline-flex rounded bg-navy-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-navy-800">
            {t('documents.detail.required')}
          </span>
        ) : null}
        {owner.href ? (
          <Link href={owner.href} className="text-sm text-navy-700 underline-offset-2 hover:underline">
            {owner.name}
          </Link>
        ) : (
          <span className="text-sm text-steel-700">{owner.name}</span>
        )}
      </div>

      {document.expiryFlag ? (
        <p
          className={`mt-4 rounded border-l-4 p-3 text-sm ${
            document.expiryFlag === 'expired'
              ? 'border-danger-500 bg-danger-50'
              : 'border-safety-500 bg-safety-50'
          }`}
        >
          {t(
            document.expiryFlag === 'expired'
              ? 'documents.detail.expired'
              : 'documents.detail.expiringSoon',
          )}{' '}
          — {day(document.expirationDate)}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title={t('documents.detail.identity')}>
            <Dl>
              <Item label={t('documents.detail.type')}>
                {t(`documents.types.${document.documentType}`)}
              </Item>
              <Item label={t('documents.detail.title')}>{document.title}</Item>
              <Item label={t('documents.detail.belongsTo')}>
                {owner.name} ({t(`documents.owners.${owner.type}`)})
              </Item>
              <Item label={t('documents.detail.issued')}>{day(document.issueDate)}</Item>
              <Item label={t('documents.detail.expires')}>
                {document.expirationDate ? day(document.expirationDate) : t('documents.detail.noExpiry')}
              </Item>
            </Dl>
          </Card>

          <Card title={t('documents.detail.versions')}>
            <p className="text-xs text-steel-600">{t('documents.detail.versionsHint')}</p>

            <ul className="mt-3 flex flex-col divide-y divide-steel-100">
              {versions.map((v) => (
                <li key={v.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums text-carbon">v{v.number}</span>
                    {v.isCurrent ? (
                      <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[11px] font-medium text-navy-800">
                        {t('documents.detail.current')}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-steel-700">{v.filename}</span>
                    <span className="text-xs tabular-nums text-steel-600">{bytes(v.bytes)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-steel-600">
                    {day(v.uploadedAt)}
                    {v.uploadedBy ? ` · ${v.uploadedBy}` : ''} ·{' '}
                    <code className="rounded bg-navy-50 px-1 py-0.5 tabular-nums">{v.sha256Prefix}…</code>
                  </p>
                  {/* Sin antivirus configurado no se dice que está limpio. Es
                      una afirmación que nadie ha comprobado.

                      Y tampoco se dice «todavía sin analizar», que es lo que
                      decía antes: eso promete un análisis en camino, y no venía
                      ninguno. Cada estado tiene su frase, y la de una
                      instalación sin antivirus lo dice con todas las letras. */}
                  {v.scanStatus !== 'clean' ? (
                    <p
                      className={`mt-0.5 text-xs ${
                        v.scanStatus === 'infected' ? 'text-danger-700' : 'text-safety-700'
                      }`}
                    >
                      {t(`documents.detail.scan.${v.scanStatus}`)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>

            {can.upload ? (
              <Link
                href="/documents/upload"
                className="mt-3 inline-block rounded border border-navy-600 px-3 py-1.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
              >
                {t('documents.detail.newVersion')}
              </Link>
            ) : null}
          </Card>

          <Card title={t('documents.review.history')}>
            {reviews.length === 0 ? (
              <p className="text-sm text-steel-700">{t('documents.review.noReviews')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-steel-100">
                {reviews.map((r, i) => (
                  <li key={i} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          REVIEW_TONE[r.decision] ?? REVIEW_TONE.pending
                        }`}
                      >
                        {t(`documents.review.${r.decision}`)}
                      </span>
                      <span className="text-xs text-steel-600">
                        {day(r.at)}
                        {r.by ? ` · ${r.by}` : ''}
                      </span>
                    </div>
                    {r.notes ? <p className="mt-1 text-xs text-steel-700">{r.notes}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {can.review ? <ReviewForm documentId={document.id} /> : null}
        </div>
      </div>
    </AppLayout>
  )
}

/**
 * Aprobar o rechazar.
 *
 * El campo de notas es obligatorio al rechazar, y se dice antes de pulsar: el
 * transportista va a leerlo, y «rechazado» a secas le obliga a adivinar qué
 * corregir, lo que garantiza una segunda subida igual de mala.
 */
function ReviewForm({ documentId }: { documentId: string }) {
  const { t } = useI18n()
  const [decision, setDecision] = useState('approved')
  const form = useForm({ decision: 'approved', notes: '' })

  return (
    <section className="rounded border border-steel-200 bg-white p-5">
      <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
        {t('documents.review.title')}
      </h2>
      <p className="mt-2 text-xs text-steel-600">{t('documents.review.hint')}</p>

      <label className="mt-3 block text-xs font-medium text-steel-700" htmlFor="decision">
        {t('documents.review.decision')}
      </label>
      <select
        id="decision"
        value={decision}
        onChange={(e) => {
          setDecision(e.target.value)
          form.setData('decision', e.target.value)
        }}
        className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
      >
        {['approved', 'in_review', 'rejected'].map((d) => (
          <option key={d} value={d}>
            {t(`documents.review.${d}`)}
          </option>
        ))}
      </select>

      <label className="mt-3 block text-xs font-medium text-steel-700" htmlFor="notes">
        {t('documents.review.notes')}
      </label>
      <textarea
        id="notes"
        rows={4}
        value={form.data.notes}
        onChange={(e) => form.setData('notes', e.target.value)}
        className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
      />
      {decision === 'rejected' ? (
        <p className="mt-1 text-xs text-safety-700">{t('documents.review.notesRequired')}</p>
      ) : null}
      {form.errors.notes ? (
        <p role="alert" className="mt-1 text-sm text-danger-700">
          {form.errors.notes}
        </p>
      ) : null}

      <button
        type="button"
        disabled={form.processing}
        onClick={() => form.post(`/documents/${documentId}/review`, { preserveScroll: true })}
        className="mt-3 w-full rounded bg-navy-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-navy-800 disabled:opacity-50"
      >
        {t('documents.review.action')}
      </button>
    </section>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-steel-200 bg-white p-5">
      <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-safety-600">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Dl({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-steel-600">{label}</dt>
      <dd className="truncate text-sm text-carbon">{children}</dd>
    </div>
  )
}
