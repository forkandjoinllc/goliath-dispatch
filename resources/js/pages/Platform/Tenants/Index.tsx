import { Link, router } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { Pager, type PageMeta } from '@/components/App/Pager'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

interface Row {
  id: string
  slug: string
  name: string
  status: string
  subscriptionStatus: string | null
  planCode: string | null
  monthlyPriceCents: number | null
  trialEndsOn: string | null
  pastDueSince: string | null
  createdOn: string
}

interface Props {
  tenants: { data: Row[]; meta: PageMeta }
  filters: { status: string; q: string }
  statuses: string[]
  counts: Record<string, number>
}

export default function PlatformTenants({ tenants, filters, statuses, counts }: Props) {
  const { t, locale } = useI18n()

  const filtrar = (patch: Partial<Props['filters']>) =>
    router.get('/platform/tenants', limpiar({ ...filters, ...patch }), {
      preserveState: true,
      replace: true,
    })

  const hayFiltros = Object.values(filters).some((v) => v !== '')

  return (
    <AppLayout
      title={t('platform.tenants.title')}
      description={t('platform.tenants.subtitle')}
      crumbs={[{ label: t('platform.tenants.title') }]}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => filtrar({ status: filters.status === s ? '' : s })}
              aria-pressed={filters.status === s}
              className={`rounded border p-3 text-left transition ${
                filters.status === s
                  ? 'border-navy-500 bg-navy-50'
                  : 'border-steel-200 bg-white hover:bg-navy-50'
              }`}
            >
              <p className="text-[11px] uppercase tracking-wide text-steel-600">
                {t(`platform.status.${s}`)}
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-carbon">{counts[s] ?? 0}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('platform.tenants.search')}</span>
            <input
              type="search"
              defaultValue={filters.q}
              onBlur={(e) => filtrar({ q: e.target.value })}
              placeholder={t('platform.tenants.searchPlaceholder')}
              className="min-w-64 rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
            />
          </label>

          {hayFiltros ? (
            <button
              type="button"
              onClick={() => router.get('/platform/tenants', {}, { preserveState: true, replace: true })}
              className="rounded border border-steel-300 px-3 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
            >
              {t('platform.tenants.clear')}
            </button>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded border border-steel-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-steel-50 text-xs uppercase tracking-wide text-steel-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('platform.tenants.name')}</th>
                <th className="px-4 py-2.5 font-medium">{t('platform.tenants.plan')}</th>
                <th className="px-4 py-2.5 font-medium">{t('platform.tenants.statusColumn')}</th>
                <th className="px-4 py-2.5 font-medium">{t('platform.tenants.subscription')}</th>
                <th className="px-4 py-2.5 font-medium">{t('platform.tenants.trialEnds')}</th>
                <th className="px-4 py-2.5 font-medium">{t('platform.tenants.signedUp')}</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {tenants.data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-steel-600">
                    {t('platform.tenants.empty')}
                  </td>
                </tr>
              ) : null}

              {tenants.data.map((x) => (
                <tr key={x.id} className="border-t border-steel-100">
                  <td className="px-4 py-2.5">
                    <Link href={`/platform/tenants/${x.id}`} className="font-medium text-navy-700 underline">
                      {x.name}
                    </Link>
                    <p className="font-mono text-xs text-steel-600">{x.slug}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {x.planCode ? (
                      <>
                        {x.planCode}
                        {x.monthlyPriceCents !== null ? (
                          <span className="ml-2 text-xs text-steel-600">
                            {formatCents(x.monthlyPriceCents, locale)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-steel-500">{t('platform.tenants.noPlan')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Estado value={x.status} />
                  </td>
                  <td className="px-4 py-2.5 text-steel-700">
                    {x.subscriptionStatus ? t(`platform.status.${x.subscriptionStatus}`) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-steel-700">
                    {x.trialEndsOn ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-steel-700">{x.createdOn}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/platform/tenants/${x.id}`} className="text-navy-700 underline">
                      {t('platform.tenants.view')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pager meta={tenants.meta} path="/platform/tenants" params={{ ...filters }} />
      </div>
    </AppLayout>
  )
}

/** Suspendida se ve de lejos: es la única que deja a gente fuera. */
export function Estado({ value }: { value: string }) {
  const { t } = useI18n()

  const tono =
    value === 'suspended' || value === 'cancelled'
      ? 'bg-danger-50 text-danger-700'
      : value === 'past_due'
        ? 'bg-warning-50 text-warning-800'
        : value === 'active'
          ? 'bg-navy-100 text-navy-800'
          : 'bg-steel-100 text-steel-700'

  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tono}`}>
      {t(`platform.status.${value}`)}
    </span>
  )
}

function limpiar(f: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''))
}
