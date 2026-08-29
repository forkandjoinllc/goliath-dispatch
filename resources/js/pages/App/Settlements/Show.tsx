import { Link, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

interface Line {
  id: string
  descriptionEn: string
  descriptionEs: string | null
  grossRateCents: number
  reimbursementsCents: number
  dispatchFeeCents: number
  deductionsCents: number
  netCents: number
  loadId: string | null
  loadNumber: string | null
}

interface Settlement {
  id: string
  number: string
  carrierName: string | null
  factoringName: string | null
  factoringSubmittedAt: string | null
  factoringCompanyId: string | null
  status: string
  grossRateCents: number
  reimbursementsCents: number
  dispatchFeesCents: number
  deductionsCents: number
  netAmountCents: number
  periodStart: string | null
  periodEnd: string | null
  notes: string | null
  lines: Line[]
}

interface Props {
  settlement: Settlement
  can: { manage: boolean }
}

export default function SettlementShow({ settlement, can }: Props) {
  const { t, locale } = useI18n()

  return (
    <AppLayout
      title={settlement.number}
      description={settlement.carrierName ?? ''}
      crumbs={[{ label: t('settlements.index.title'), href: '/settlements' }, { label: settlement.number }]}
    >
      <div className="flex max-w-4xl flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-5">
          <Tile label={t('settlements.show.gross')} value={formatCents(settlement.grossRateCents, locale)} />
          <Tile label={t('settlements.show.reimbursements')} value={formatCents(settlement.reimbursementsCents, locale)} />
          <Tile label={t('settlements.show.fees')} value={`− ${formatCents(settlement.dispatchFeesCents, locale)}`} />
          <Tile label={t('settlements.show.deductions')} value={`− ${formatCents(settlement.deductionsCents, locale)}`} />
          <Tile label={t('settlements.show.net')} value={formatCents(settlement.netAmountCents, locale)} strong />
        </div>

        {settlement.factoringName ? (
          <div className="rounded border-l-4 border-navy-500 bg-navy-50 p-3 text-sm">
            {/* La plataforma REGISTRA a quién hay que pagarle. No paga. */}
            <p className="font-semibold">{t('settlements.show.factoring', { name: settlement.factoringName })}</p>
            <p className="mt-1 text-steel-700">{t('settlements.show.factoringNote')}</p>
          </div>
        ) : null}

        <div className="overflow-x-auto rounded border border-steel-200 bg-white">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-steel-50 text-left text-xs uppercase tracking-wide text-steel-600">
              <tr>
                <th className="px-4 py-2.5">{t('settlements.show.load')}</th>
                <th className="px-4 py-2.5 text-right">{t('settlements.show.gross')}</th>
                <th className="px-4 py-2.5 text-right">{t('settlements.show.reimbursements')}</th>
                <th className="px-4 py-2.5 text-right">{t('settlements.show.fees')}</th>
                <th className="px-4 py-2.5 text-right">{t('settlements.show.deductions')}</th>
                <th className="px-4 py-2.5 text-right">{t('settlements.show.net')}</th>
              </tr>
            </thead>
            <tbody>
              {settlement.lines.map((l) => (
                <tr key={l.id} className="border-t border-steel-100">
                  <td className="px-4 py-2.5">
                    {l.loadId ? (
                      <Link href={`/loads/${l.loadId}`} className="text-navy-700 underline">
                        {l.loadNumber}
                      </Link>
                    ) : (
                      (locale === 'es' && l.descriptionEs ? l.descriptionEs : l.descriptionEn)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(l.grossRateCents, locale)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(l.reimbursementsCents, locale)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">− {formatCents(l.dispatchFeeCents, locale)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">− {formatCents(l.deductionsCents, locale)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatCents(l.netCents, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-steel-600">{t('settlements.show.frozenNote')}</p>

        <Actions settlement={settlement} can={can} />
      </div>
    </AppLayout>
  )
}

function Actions({ settlement, can }: Props) {
  const { t } = useI18n()
  const [anulando, setAnulando] = useState(false)

  const emitir = useForm({})
  const pagar = useForm({ factoring_submitted: false })
  const anular = useForm({ reason: '' })

  if (! can.manage || settlement.status === 'voided') return null

  return (
    <div className="flex flex-col gap-3 rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        {settlement.status === 'draft' ? (
          <button
            type="button"
            disabled={emitir.processing}
            onClick={() => emitir.post(`/settlements/${settlement.id}/issue`, { preserveScroll: true })}
            className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:opacity-50"
          >
            {t('settlements.show.issue')}
          </button>
        ) : null}

        {settlement.status === 'issued' ? (
          <>
            {settlement.factoringCompanyId ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={pagar.data.factoring_submitted}
                  onChange={(e) => pagar.setData('factoring_submitted', e.target.checked)}
                />
                {t('settlements.show.sentToFactoring')}
              </label>
            ) : null}
            <button
              type="button"
              disabled={pagar.processing}
              onClick={() => pagar.post(`/settlements/${settlement.id}/pay`, { preserveScroll: true })}
              className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
            >
              {t('settlements.show.markPaid')}
            </button>
          </>
        ) : null}

        {settlement.status !== 'paid' ? (
          <button
            type="button"
            onClick={() => setAnulando(!anulando)}
            className="rounded border border-danger-300 px-4 py-2 text-sm font-medium text-danger-700 transition hover:bg-danger-50"
          >
            {t('settlements.show.void')}
          </button>
        ) : null}
      </div>

      {anulando ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            anular.post(`/settlements/${settlement.id}/void`, { preserveScroll: true })
          }}
          className="flex flex-col gap-2 border-t border-steel-100 pt-3"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('settlements.show.voidReason')}</span>
            <textarea
              rows={3}
              value={anular.data.reason}
              onChange={(e) => anular.setData('reason', e.target.value)}
              className="rounded border border-steel-300 px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
            />
          </label>
          <div>
            <button
              type="submit"
              disabled={anular.processing}
              className="rounded bg-danger-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-danger-700 disabled:opacity-50"
            >
              {t('settlements.show.confirmVoid')}
            </button>
          </div>
          {anular.errors.reason ? (
            <p role="alert" className="text-sm text-danger-700">{anular.errors.reason}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded border p-3 ${strong ? 'border-safety-300 bg-safety-50' : 'border-steel-200 bg-white'}`}>
      <p className="text-xs uppercase tracking-wide text-steel-600">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums text-carbon">{value}</p>
    </div>
  )
}
