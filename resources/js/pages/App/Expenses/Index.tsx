import { Link, router, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { Pager, type PageMeta } from '@/components/App/Pager'
import { useI18n } from '@/lib/i18n'

interface Row {
  id: string
  loadId: string | null
  loadNumber: string | null
  categoryEn: string | null
  categoryEs: string | null
  amountCents: number
  treatment: string
  status: string
  description: string | null
  incurredOn: string | null
  rejectionReason: string | null
  /** El recibo, si lo tiene. Nulo cuando no hay. */
  receipt: { id: string; url: string } | null
  /** Si su categoría exigía recibo EL DÍA QUE SE PRESENTÓ. */
  requiresReceipt: boolean
  /** La carga ya tiene cifras congeladas: este gasto no las cambia. */
  loadFrozen?: boolean
}

interface Props {
  expenses: { data: Row[]; meta: PageMeta }
  filters: { status: string; load: string }
  statuses: string[]
  totals: { pendingCents: number; countingCents: number }
  can: { submit: boolean; approve: boolean }
}

export default function ExpensesIndex({ expenses, filters, statuses, totals, can }: Props) {
  const { t, locale } = useI18n()

  return (
    <AppLayout
      title={t('expenses.index.title')}
      description={t('expenses.index.subtitle')}
      crumbs={[{ label: t('expenses.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile label={t('expenses.index.pending')} value={formatCents(totals.pendingCents, locale)} />
          {/* Lo que de verdad importa: cuánto ya entra en facturas y
              liquidaciones. Un gasto presentado no mueve un céntimo. */}
          <Tile label={t('expenses.index.counting')} value={formatCents(totals.countingCents, locale)} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('expenses.index.status')}</span>
            <select
              value={filters.status}
              onChange={(e) =>
                router.get('/expenses', { status: e.target.value, load: filters.load }, { preserveState: true, replace: true })
              }
              className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
            >
              <option value="">{t('expenses.index.anyStatus')}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {t(`expenses.status.${s}`)}
                </option>
              ))}
            </select>
          </label>

          {can.submit ? (
            <Link
              href="/expenses/create"
              className="ml-auto rounded bg-safety-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700"
            >
              {t('expenses.index.create')}
            </Link>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          {expenses.data.length === 0 ? (
            <p className="rounded border border-steel-200 bg-white p-8 text-center text-sm text-steel-600">
              {t('expenses.index.empty')}
            </p>
          ) : null}

          {expenses.data.map((e) => (
            <ExpenseCard key={e.id} expense={e} canApprove={can.approve} canSubmit={can.submit} />
          ))}
        </div>

        <Pager meta={expenses.meta} path="/expenses" params={{ ...filters }} />
      </div>
    </AppLayout>
  )
}

function ExpenseCard({
  expense: e, canApprove, canSubmit,
}: {
  expense: Row
  canApprove: boolean
  canSubmit: boolean
}) {
  const { t, locale } = useI18n()
  const [rechazando, setRechazando] = useState(false)

  const decidir = useForm({})
  const rechazo = useForm({ reason: '' })

  // `useForm({})` tipa sus errores por el payload, que aquí está vacío: el
  // error llega en `status`, que el servidor añade y el tipo no conoce. Se lee
  // por índice en vez de ensuciar el payload con un campo que no se manda.
  const errorDeDecision = (decidir.errors as Record<string, string | undefined>).status

  return (
    <div className="rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-carbon">
            {locale === 'es' && e.categoryEs ? e.categoryEs : (e.categoryEn ?? '—')}
            <span className="ml-2 text-steel-600">
              {e.loadId ? (
                <Link href={`/loads/${e.loadId}`} className="underline">
                  {e.loadNumber}
                </Link>
              ) : null}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-steel-600">
            {t(`expenses.treatment.${e.treatment}`)}
            {e.incurredOn ? ` · ${e.incurredOn}` : ''}
          </p>
          {e.description ? <p className="mt-1 text-sm text-steel-700">{e.description}</p> : null}
          {e.rejectionReason ? (
            <p className="mt-1 text-sm text-danger-700">{e.rejectionReason}</p>
          ) : null}
        </div>

        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums text-carbon">{formatCents(e.amountCents, locale)}</p>
          <p className="text-xs text-steel-600">{t(`expenses.status.${e.status}`)}</p>
        </div>
      </div>

      {/* El recibo. La insignia y el aviso van juntos y antes de los botones:
          quien va a aprobar tiene que ver que falta el papel ANTES de pulsar,
          no descubrirlo en el error de validación. */}
      <Recibo gasto={e} puedeSubir={canApprove || canSubmit} puedeQuitar={canApprove} />

      {/* Si la carga ya está facturada o liquidada, aprobar esto no cambia esos
          documentos: sus cifras están congeladas. Se dice antes de pulsar. */}
      {e.loadFrozen && e.status === 'submitted' ? (
        <p className="mt-3 rounded border-l-4 border-safety-500 bg-safety-50 p-2 text-xs">
          {t('expenses.index.frozenWarning')}
        </p>
      ) : null}

      {/* Por qué NO se pudo decidir.
          La puerta del recibo devuelve un error de validación en `status`, y
          esta pantalla no pintaba ningún error: se pulsaba «Aprobar», la puerta
          lo paraba bien, y quien lo pulsó no veía absolutamente nada. Una
          puerta silenciosa se vive como un botón roto. Lo encontró el
          navegador, no la suite. */}
      {errorDeDecision ? (
        <p role="alert" className="mt-3 rounded border-l-4 border-danger-500 bg-danger-50 p-2 text-sm text-carbon">
          {errorDeDecision}
        </p>
      ) : null}

      {canApprove ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-steel-100 pt-3">
          {e.status === 'submitted' ? (
            <>
              <button
                type="button"
                disabled={decidir.processing}
                onClick={() => decidir.post(`/expenses/${e.id}/approve`, { preserveScroll: true })}
                className="rounded bg-safety-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-safety-700 disabled:opacity-50"
              >
                {t('expenses.index.approve')}
              </button>
              <button
                type="button"
                onClick={() => setRechazando(!rechazando)}
                className="rounded border border-danger-300 px-3 py-1.5 text-xs font-medium text-danger-700 transition hover:bg-danger-50"
              >
                {t('expenses.index.reject')}
              </button>
            </>
          ) : null}

          {e.status === 'approved' ? (
            <button
              type="button"
              disabled={decidir.processing}
              onClick={() => decidir.post(`/expenses/${e.id}/reimburse`, { preserveScroll: true })}
              className="rounded border border-steel-300 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
            >
              {t('expenses.index.reimburse')}
            </button>
          ) : null}
        </div>
      ) : null}

      {rechazando ? (
        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            rechazo.post(`/expenses/${e.id}/reject`, { preserveScroll: true })
          }}
          className="mt-3 flex flex-col gap-2"
        >
          <textarea
            rows={2}
            value={rechazo.data.reason}
            onChange={(ev) => rechazo.setData('reason', ev.target.value)}
            placeholder={t('expenses.index.rejectReason')}
            className="rounded border border-steel-300 px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
          <div>
            <button
              type="submit"
              disabled={rechazo.processing}
              className="rounded bg-danger-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-danger-700 disabled:opacity-50"
            >
              {t('expenses.index.confirmReject')}
            </button>
          </div>
          {rechazo.errors.reason ? (
            <p role="alert" className="text-xs text-danger-700">{rechazo.errors.reason}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}

/**
 * El recibo de un gasto: si lo hay, si hace falta, y cómo ponerlo.
 *
 * `requiresReceipt` viene de la copia CONGELADA del gasto, no de la categoría
 * de hoy: marcar «peajes» como categoría con recibo el mes que viene no puede
 * dejar mal aprobados los peajes de este.
 */
function Recibo({
  gasto: e, puedeSubir, puedeQuitar,
}: {
  gasto: Row
  puedeSubir: boolean
  puedeQuitar: boolean
}) {
  const { t } = useI18n()
  const subida = useForm<{ file: File | null }>({ file: null })
  const quitar = useForm({})

  // Ni tiene recibo ni le hace falta: no se dice nada. Un aviso que sale
  // siempre deja de leerse, y entonces tampoco se lee el que importa.
  if (e.receipt === null && ! e.requiresReceipt) {
    return null
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-steel-200 bg-steel-50/60 p-2.5">
      <span className="text-xs font-medium uppercase tracking-wide text-steel-600">
        {t('expenses.receipt.title')}
      </span>

      {e.receipt !== null ? (
        <a
          href={e.receipt.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-navy-700 underline hover:text-navy-900"
        >
          {t('expenses.receipt.view')}
        </a>
      ) : (
        <span className="rounded bg-warning-100 px-2 py-0.5 text-xs font-medium text-carbon">
          {t('expenses.receipt.missing')}
        </span>
      )}

      {e.requiresReceipt ? (
        <span className="text-xs text-steel-600">
          {/* La frase larga solo mientras la decisión esté por tomar. Sobre un
              gasto YA aprobado, «sin él no se puede aprobar» se contradice con
              lo que la propia tarjeta dice dos líneas más arriba: se aprobó.
              Ahí lo que queda es constancia de que falta el papel. */}
          {e.receipt === null && e.status === 'submitted'
            ? t('expenses.receipt.requiredHint')
            : t('expenses.receipt.required')}
        </span>
      ) : null}

      {puedeSubir ? (
        <label className="ml-auto cursor-pointer text-sm font-medium text-navy-700 underline hover:text-navy-900">
          {e.receipt === null ? t('expenses.receipt.upload') : t('expenses.receipt.replace')}
          <input
            type="file"
            className="hidden"
            accept="application/pdf,image/*"
            disabled={subida.processing}
            onChange={(ev) => {
              const f = ev.target.files?.[0]
              if (f === undefined) return
              subida.setData('file', f)
              // `transform` no encadena en esta versión de Inertia: devuelve
              // void y se aplica al siguiente envío.
              subida.transform(() => ({ file: f }))
              subida.post(`/expenses/${e.id}/receipt`, {
                preserveScroll: true,
                forceFormData: true,
                onFinish: () => { ev.target.value = '' },
              })
            }}
          />
        </label>
      ) : null}

      {puedeQuitar && e.receipt !== null ? (
        <button
          type="button"
          disabled={quitar.processing}
          onClick={() => quitar.delete(`/expenses/${e.id}/receipt`, { preserveScroll: true })}
          className="text-sm font-medium text-danger-700 underline hover:text-danger-900 disabled:opacity-50"
        >
          {t('expenses.receipt.remove')}
        </button>
      ) : null}
    </div>
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
