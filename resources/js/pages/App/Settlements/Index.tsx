import { Link, router } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { Pager, type PageMeta } from '@/components/App/Pager'
import { useI18n } from '@/lib/i18n'

interface Row {
  id: string
  number: string
  carrierName: string | null
  status: string
  netAmountCents: number
  dispatchFeesCents: number
  periodStart: string | null
  periodEnd: string | null
}

interface Props {
  settlements: { data: Row[]; meta: PageMeta }
  filters: { search: string; status: string }
  statuses: string[]
  totals: { netCents: number; dispatchFeesCents: number }
  can: { manage: boolean }
}

export default function SettlementsIndex({ settlements, filters, statuses, totals, can }: Props) {
  const { t, locale } = useI18n()

  return (
    <AppLayout
      title={t('settlements.index.title')}
      description={t('settlements.index.subtitle')}
      crumbs={[{ label: t('settlements.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile label={t('settlements.index.netTotal')} value={formatCents(totals.netCents, locale)} />
          <Tile label={t('settlements.index.feesTotal')} value={formatCents(totals.dispatchFeesCents, locale)} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('settlements.index.status')}</span>
            <select
              value={filters.status}
              onChange={(e) =>
                router.get('/settlements', { status: e.target.value }, { preserveState: true, replace: true })
              }
              className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
            >
              <option value="">{t('settlements.index.anyStatus')}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {t(`settlements.status.${s}`)}
                </option>
              ))}
            </select>
          </label>

          {can.manage ? (
            <Link
              href="/settlements/create"
              className="ml-auto rounded bg-safety-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700"
            >
              {t('settlements.index.create')}
            </Link>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded border border-steel-200 bg-white">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-steel-50 text-left text-xs uppercase tracking-wide text-steel-600">
              <tr>
                <th className="px-4 py-2.5">{t('settlements.index.number')}</th>
                <th className="px-4 py-2.5">{t('settlements.index.carrier')}</th>
                <th className="px-4 py-2.5">{t('settlements.index.period')}</th>
                <th className="px-4 py-2.5">{t('settlements.index.status')}</th>
                <th className="px-4 py-2.5 text-right">{t('settlements.index.net')}</th>
              </tr>
            </thead>
            <tbody>
              {settlements.data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-steel-600">
                    {t('settlements.index.empty')}
                  </td>
                </tr>
              ) : null}

              {settlements.data.map((s) => (
                <tr key={s.id} className="border-t border-steel-100">
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={`/settlements/${s.id}`} className="text-navy-700 underline">
                      {s.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{s.carrierName ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {s.periodStart} — {s.periodEnd}
                  </td>
                  <td className="px-4 py-2.5">{t(`settlements.status.${s.status}`)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(s.netAmountCents, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pager meta={settlements.meta} path="/settlements" params={{ ...filters }} />
      </div>
    </AppLayout>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-steel-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-steel-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-carbon">{value}</p>
    </div>
  )
}
