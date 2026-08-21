import { Link, router } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Doc {
  id: string
  title: string
  documentType: string
  ownerType: string
  ownerKey: string
  reviewStatus: string
  isRequired: boolean
  issueDate: string | null
  expirationDate: string | null
  expiryFlag: string | null
}

interface Props {
  documents: {
    data: Doc[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }
  owners: Record<string, string>
  filters: { search: string; owner: string; status: string; expiring: string }
  scope: string
  facets: Record<string, number>
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

function navigate(filters: Props['filters'], patch: Partial<Props['filters']>) {
  const next: Record<string, string> = { ...filters, ...patch }
  for (const key of Object.keys(next)) {
    if (next[key] === '') delete next[key]
  }
  router.get('/documents', next, { preserveState: true, preserveScroll: true, replace: true })
}

export default function DocumentsIndex({ documents, owners, filters, scope, facets, can }: Props) {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState(filters.search)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const timer = setTimeout(() => navigate(filters, { search }), 300)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const { meta } = documents
  const from = meta.total === 0 ? 0 : (meta.currentPage - 1) * meta.perPage + 1
  const to = Math.min(meta.currentPage * meta.perPage, meta.total)
  const filtered = Object.values(filters).some((v) => v !== '')

  const day = (value: string | null): string =>
    value
      ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { dateStyle: 'medium' }).format(
          new Date(`${value}T00:00:00`),
        )
      : '—'

  return (
    <AppLayout
      title={t('documents.index.title')}
      description={t('documents.index.subtitle')}
      crumbs={[{ label: t('documents.index.title') }]}
      actions={
        can.upload ? (
          <Link
            href="/documents/upload"
            className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700"
          >
            {t('documents.index.upload')}
          </Link>
        ) : null
      }
    >
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-steel-600">
        {t(`documents.scope.${scope}`)}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Chip
          label={t('documents.filters.all')}
          count={facets.all ?? 0}
          active={filters.status === '' && filters.expiring === ''}
          onClick={() => navigate(filters, { status: '', expiring: '' })}
        />
        {/* Pendientes primero: es la cola de trabajo de quien revisa. */}
        {['pending', 'in_review', 'rejected', 'approved'].map((s) => (
          <Chip
            key={s}
            label={t(`documents.review.${s}`)}
            count={facets[s] ?? 0}
            active={filters.status === s}
            onClick={() => navigate(filters, { status: filters.status === s ? '' : s, expiring: '' })}
          />
        ))}
        <Chip
          label={t('documents.filters.expiring')}
          count={facets.expiring ?? 0}
          active={filters.expiring === '1'}
          warn
          onClick={() => navigate(filters, { expiring: filters.expiring === '1' ? '' : '1', status: '' })}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="document-search" className="sr-only">
            {t('documents.index.searchLabel')}
          </label>
          <input
            id="document-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('documents.index.searchPlaceholder')}
            className="w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-steel-500 focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium text-steel-700">
          {t('documents.filters.owner')}
          <select
            value={filters.owner}
            onChange={(e) => navigate(filters, { owner: e.target.value })}
            className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          >
            <option value="">{t('documents.filters.all')}</option>
            {['carrier', 'driver', 'truck', 'trailer'].map((o) => (
              <option key={o} value={o}>
                {t(`documents.owners.${o}`)}
              </option>
            ))}
          </select>
        </label>

        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              router.get('/documents', {}, { preserveScroll: true, replace: true })
            }}
            className="rounded border border-steel-300 px-3 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
          >
            {t('documents.filters.clear')}
          </button>
        ) : null}
      </div>

      {documents.data.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-steel-300 bg-white p-10 text-center">
          <p className="font-display text-lg font-bold text-navy-700">
            {t(filtered ? 'documents.index.noResults' : 'documents.index.empty')}
          </p>
          <p className="mt-1 text-sm text-steel-700">
            {t(filtered ? 'documents.index.noResultsHint' : 'documents.index.emptyHint')}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded border border-steel-200 bg-white">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-steel-200 bg-navy-50 text-left">
                  {['document', 'belongsTo', 'issued', 'expires', 'review'].map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-steel-700"
                    >
                      {t(`documents.columns.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents.data.map((d) => (
                  <tr key={d.id} className="border-b border-steel-100 last:border-0 hover:bg-navy-50/60">
                    <td className="px-3 py-3">
                      <Link
                        href={`/documents/${d.id}`}
                        className="font-medium text-navy-700 underline-offset-2 hover:underline"
                      >
                        {t(`documents.types.${d.documentType}`)}
                      </Link>
                      <span className="block max-w-56 truncate text-xs text-steel-600">{d.title}</span>
                      {d.isRequired ? (
                        <span className="mt-0.5 inline-flex rounded bg-navy-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-navy-800">
                          {t('documents.detail.required')}
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-40 truncate px-3 py-3 text-steel-700">
                      {owners[d.ownerKey] ?? '—'}
                      <span className="block text-xs text-steel-600">
                        {t(`documents.owners.${d.ownerType}`)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-steel-700">{day(d.issueDate)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span
                        className={d.expiryFlag === 'expired' ? 'font-medium text-danger-700' : 'text-steel-700'}
                      >
                        {day(d.expirationDate)}
                      </span>
                      {d.expiryFlag ? (
                        <span
                          className={`block text-xs font-medium ${
                            d.expiryFlag === 'expired' ? 'text-danger-700' : 'text-safety-700'
                          }`}
                        >
                          {t(
                            d.expiryFlag === 'expired'
                              ? 'documents.detail.expired'
                              : 'documents.detail.expiringSoon',
                          )}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          REVIEW_TONE[d.reviewStatus] ?? REVIEW_TONE.pending
                        }`}
                      >
                        {t(`documents.review.${d.reviewStatus}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-steel-700">
            <p>{t('documents.index.showing', { from, to, total: meta.total })}</p>

            {meta.lastPage > 1 ? (
              <div className="flex gap-1">
                {Array.from({ length: meta.lastPage }, (_, i) => i + 1).map((n) => (
                  <Link
                    key={n}
                    href={`/documents?${new URLSearchParams({
                      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
                      page: String(n),
                    })}`}
                    aria-current={n === meta.currentPage ? 'page' : undefined}
                    preserveScroll
                    className={`rounded px-3 py-1.5 transition ${
                      n === meta.currentPage
                        ? 'bg-navy-700 font-semibold text-white'
                        : 'border border-steel-300 hover:bg-navy-50'
                    }`}
                  >
                    {n}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </>
      )}
    </AppLayout>
  )
}

function Chip({
  label, count, active, onClick, warn,
}: { label: string; count: number; active: boolean; onClick: () => void; warn?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? warn
            ? 'border-safety-600 bg-safety-600 text-white'
            : 'border-navy-700 bg-navy-700 text-white'
          : warn && count > 0
            ? 'border-safety-400 bg-safety-50 text-safety-800 hover:bg-safety-100'
            : 'border-steel-300 bg-white text-steel-800 hover:bg-navy-50'
      }`}
    >
      {label}
      <span className={`ml-1.5 tabular-nums ${active ? 'opacity-80' : 'text-steel-500'}`}>{count}</span>
    </button>
  )
}
